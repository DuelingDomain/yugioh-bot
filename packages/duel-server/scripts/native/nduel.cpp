// nduel: native N-duelist duel driver for the multi-duelist ygopro-core (ASan + UBSan build).
//
//   nduel --n 2|3|4 --mode ffa|tag --seed S [--turns 60] [--lp 8000] [--max-steps 20000]
//         [--setup-always] [--check-future] [--domain] [--domain-lua FILE] [--trace] [--data DIR] [--scripts DIR] [--stall-steps K]
//         [--multi-scripts DIR] [--probe-overlay]
//
// Plays one whole seeded duel. Every select prompt gets a seeded random VALID answer (if the core answers
// MSG_RETRY, the next attempt uses a safer strategy). Prints one summary line on success:
//   NDUEL ok n=3 mode=ffa seed=S turns=T steps=K winner=W hash=<64-bit FNV-1a of all message bytes> retries=R
// and, on a failed check, `NDUEL FAIL <check> seed=S step=K detail` with exit code 1. A sanitizer report or a
// YGO_N_TRAP abort kills the process (run-nduel.sh reads stderr for them).
//
// Order checks (all "future", off by default): response-order, direct-pick, opponent-pick, eliminated-cards, segoc-order,
// field-disabled-n, msg-format. See README.md.
// Checks that need later core work (T3 response order, T4 battle, T5 elimination/team LP, turn order for n > 2)
// only run with --check-future. Without it they print `NDUEL NOTE <check> ...` (once per check) to stderr and
// are counted in the `future=` field of the summary line.
//
// Card data and the deck pool come from dump-card-data.mjs (text files). Card scripts are read from the
// card-scripts folder of the duel engine data directory.
//
// Lua overlay (n > 2 only, design F7 section 4): mp-utility.lua is loaded after utility.lua (and domain.lua) and before
// any card exists. Each cNNN.lua of the overlay folder is appended to the original script of that card; a file that
// starts with --@replace replaces it. The folder is --multi-scripts DIR, else env DUEL_MULTI_SCRIPTS_DIR, else
// <scripts>/../multi-scripts (the deployed bundle), else packages/duel-server/domain-core/multi-scripts. At n = 2
// nothing is read and the script text is the original. --probe-overlay prints `NDUEL PROBE MP_OVERLAY_ACTIVE=<value>`
// to stderr just before the duel starts. The overlay card list is the cNNN.lua files of the folder
// (the TS reader checks that they match MANIFEST.json).
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "response-order.h"

namespace fs = std::filesystem;

// ---------------------------------------------------------------------------------------------------------------
// Options and helpers

struct Options {
	int n = 2;
	bool tag = false;
	uint64_t seed = 1;
	int turns = 60;
	uint32_t lp = 8000;
	long max_steps = 20000;
	long stall_steps = 3000;
	bool setup_always = false;
	bool check_future = false;
	bool trace = false;
	bool domain = false;
	std::string domain_lua = "packages/duel-server/domain-core/lua/domain.lua";
	std::string data = "packages/duel-server/domain-core/.build/nduel/data";
	std::string scripts = "data/duel-engine-next/card-scripts";
	std::string multi_scripts;
	bool probe_overlay = false;
} opt;

static uint64_t splitmix(uint64_t& s) {
	uint64_t z = (s += 0x9E3779B97F4A7C15ull);
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
	z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
	return z ^ (z >> 31);
}

struct Rng {
	uint64_t s;
	explicit Rng(uint64_t seed) : s(seed * 0x2545F4914F6CDD1Dull + 12345) {}
	uint64_t next() { return splitmix(s); }
	uint32_t below(uint32_t n) { return n == 0 ? 0 : static_cast<uint32_t>(next() % n); }
	int range(int lo, int hi) { return lo + static_cast<int>(below(static_cast<uint32_t>(hi - lo + 1))); }
	bool chance(double p) { return (next() >> 11) * (1.0 / 9007199254740992.0) < p; }
	template<typename T> void shuffle(std::vector<T>& v) {
		for(size_t i = v.size(); i > 1; --i)
			std::swap(v[i - 1], v[below(static_cast<uint32_t>(i))]);
	}
	template<typename T> const T& pick(const std::vector<T>& v) { return v[below(static_cast<uint32_t>(v.size()))]; }
	size_t weighted(const std::vector<double>& w) {
		double total = 0;
		for(double x : w) total += x;
		double r = (next() >> 11) * (1.0 / 9007199254740992.0) * total;
		for(size_t i = 0; i < w.size(); ++i) {
			if(r < w[i]) return i;
			r -= w[i];
		}
		return w.size() - 1;
	}
};

static Rng* g_rng = nullptr;

static long g_step = 0;
static void fail(const char* check, const std::string& detail) {
	std::printf("NDUEL FAIL %s seed=%llu step=%ld %s\n", check, static_cast<unsigned long long>(opt.seed), g_step, detail.c_str());
	std::fflush(stdout);
	std::exit(1);
}

static std::map<std::string, long> g_future;
static void future_check(const char* check, const std::string& detail) {
	if(opt.check_future)
		fail(check, detail);
	if(g_future[check]++ == 0)
		std::fprintf(stderr, "NDUEL NOTE %s seed=%llu step=%ld %s\n", check, static_cast<unsigned long long>(opt.seed), g_step, detail.c_str());
}

// Payload reader. Reading past the end is a parse failure of the driver (or a malformed core message).
struct Reader {
	const uint8_t* p;
	size_t n, i = 0;
	int id;
	Reader(const uint8_t* data, size_t len, int msg_id) : p(data), n(len), id(msg_id) {}
	template<typename T> T get() {
		if(i + sizeof(T) > n)
			fail("msg-parse", "message " + std::to_string(id) + " too short at offset " + std::to_string(i));
		T v;
		std::memcpy(&v, p + i, sizeof(T));
		i += sizeof(T);
		return v;
	}
	void skip(size_t k) {
		if(i + k > n)
			fail("msg-parse", "message " + std::to_string(id) + " too short (skip) at offset " + std::to_string(i));
		i += k;
	}
};

struct Bytes {
	std::vector<uint8_t> v;
	template<typename T> void put(size_t off, T value) {
		if(v.size() < off + sizeof(T)) v.resize(off + sizeof(T), 0);
		std::memcpy(v.data() + off, &value, sizeof(T));
	}
	void pad(size_t len) { if(v.size() < len) v.resize(len, 0); }
};

// ---------------------------------------------------------------------------------------------------------------
// Card data, scripts, decks

struct CardRow {
	OCG_CardData d;
	std::vector<uint16_t> sets;
};
static std::unordered_map<uint32_t, CardRow> g_cards;
static std::vector<uint32_t> g_card_codes;

static void load_cards() {
	std::ifstream in(opt.data + "/cards.tsv");
	if(!in) {
		std::fprintf(stderr, "nduel: cannot read %s/cards.tsv (run dump-card-data.mjs)\n", opt.data.c_str());
		std::exit(2);
	}
	std::string line;
	while(std::getline(in, line)) {
		std::istringstream ss(line);
		CardRow row;
		std::memset(&row.d, 0, sizeof(row.d));
		unsigned long long race = 0;
		std::string sets;
		long long atk = 0, def = 0;
		uint32_t code = 0, alias = 0, type = 0, level = 0, attr = 0, ls = 0, rs = 0, lm = 0;
		ss >> code >> alias >> type >> level >> attr >> race >> atk >> def >> ls >> rs >> lm >> sets;
		row.d.code = code;
		row.d.alias = alias;
		row.d.type = type;
		row.d.level = level;
		row.d.attribute = attr;
		row.d.race = race;
		row.d.attack = static_cast<int32_t>(atk);
		row.d.defense = static_cast<int32_t>(def);
		row.d.lscale = ls;
		row.d.rscale = rs;
		row.d.link_marker = lm;
		if(sets != "-") {
			std::istringstream ts(sets);
			std::string tok;
			while(std::getline(ts, tok, ','))
				row.sets.push_back(static_cast<uint16_t>(std::stoul(tok)));
		}
		row.sets.push_back(0);
		g_card_codes.push_back(code);
		g_cards.emplace(code, std::move(row));
	}
	for(auto& kv : g_cards)
		kv.second.d.setcodes = kv.second.sets.data();
}

static void on_read_card(void*, uint32_t code, OCG_CardData* data) {
	auto it = g_cards.find(code);
	if(it == g_cards.end()) {
		std::memset(data, 0, sizeof(*data));
		data->code = code;
		return;
	}
	*data = it->second.d;
}

static std::unordered_map<std::string, std::string> g_script_index;
static void index_scripts() {
	fs::path root(opt.scripts);
	if(!fs::exists(root)) {
		std::fprintf(stderr, "nduel: script folder missing: %s\n", opt.scripts.c_str());
		std::exit(2);
	}
	for(const auto& e : fs::recursive_directory_iterator(root)) {
		if(!e.is_regular_file() || e.path().extension() != ".lua") continue;
		g_script_index[e.path().filename().string()] = e.path().string();
		g_script_index[fs::relative(e.path(), root).generic_string()] = e.path().string();
	}
}

// Lua overlay for n > 2. Empty (and g_overlay_on false) at n = 2, so on_read_script then returns the original text.
static bool g_overlay_on = false;
static std::string g_overlay_utility;
static std::unordered_map<std::string, std::string> g_overlay_cards; // "c123.lua" -> file text

static bool read_text_file(const fs::path& path, std::string& out) {
	std::ifstream in(path, std::ios::binary);
	if(!in) return false;
	std::stringstream buf;
	buf << in.rdbuf();
	out = buf.str();
	return true;
}

static bool is_card_script_name(const std::string& file) {
	if(file.size() < 6 || file[0] != 'c' || file.compare(file.size() - 4, 4, ".lua") != 0) return false;
	for(size_t i = 1; i + 4 < file.size(); ++i)
		if(file[i] < '0' || file[i] > '9') return false;
	return true;
}

static void load_overlay() {
	fs::path dir;
	const char* env = std::getenv("DUEL_MULTI_SCRIPTS_DIR");
	if(!opt.multi_scripts.empty()) dir = opt.multi_scripts;
	else if(env && *env) dir = env;
	else if(fs::is_directory(fs::path(opt.scripts) / ".." / "multi-scripts")) dir = fs::path(opt.scripts) / ".." / "multi-scripts";
	else dir = "packages/duel-server/domain-core/multi-scripts";
	if(!fs::is_directory(dir)) {
		std::fprintf(stderr, "nduel: multi-scripts folder missing: %s (n > 2 needs it; --multi-scripts DIR)\n", dir.string().c_str());
		std::exit(2);
	}
	if(!read_text_file(dir / "mp-utility.lua", g_overlay_utility)) {
		std::fprintf(stderr, "nduel: mp-utility.lua missing in %s\n", dir.string().c_str());
		std::exit(2);
	}
	for(const auto& e : fs::directory_iterator(dir)) {
		const std::string file = e.path().filename().string();
		if(!e.is_regular_file() || !is_card_script_name(file)) continue;
		read_text_file(e.path(), g_overlay_cards[file]);
	}
	g_overlay_on = true;
}

static bool g_log_trace = false;
static long g_script_errors = 0;
static std::string g_last_lp_line;

static int on_read_script(void*, OCG_Duel duel, const char* name) {
	std::string n(name);
	std::replace(n.begin(), n.end(), '\\', '/');
	auto it = g_script_index.find(n);
	if(it == g_script_index.end()) {
		auto slash = n.find_last_of('/');
		if(slash != std::string::npos) it = g_script_index.find(n.substr(slash + 1));
	}
	std::string text;
	bool found = it != g_script_index.end();
	if(found) {
		std::ifstream in(it->second, std::ios::binary);
		std::stringstream buf;
		buf << in.rdbuf();
		text = buf.str();
	}
	if(g_overlay_on) {
		const auto slash = n.find_last_of('/');
		const auto card = g_overlay_cards.find(slash == std::string::npos ? n : n.substr(slash + 1));
		if(card != g_overlay_cards.end()) {
			const std::string& suffix = card->second;
			if(suffix.compare(0, 10, "--@replace") == 0) { text = suffix; found = true; }
			else if(found) { if(!text.empty() && text.back() != '\n') text += '\n'; text += suffix; }
		}
	}
	if(!found)
		return 0;
	return OCG_LoadScript(duel, text.data(), static_cast<uint32_t>(text.size()), name);
}

static void on_log(void*, const char* text, int type) {
	if(type == OCG_LOG_TYPE_FROM_SCRIPT && std::strncmp(text, "NDUEL_PROBE ", 12) == 0) {
		std::fprintf(stderr, "NDUEL PROBE %s\n", text + 12);
		return;
	}
	if(type == OCG_LOG_TYPE_FROM_SCRIPT && std::strncmp(text, "NDUEL_LP ", 9) == 0) {
		g_last_lp_line = text + 9;
		return;
	}
	if(type == OCG_LOG_TYPE_ERROR || type == OCG_LOG_TYPE_UNDEFINED)
		++g_script_errors;
	if(g_log_trace)
		std::fprintf(stderr, "core log [%d]: %s\n", type, text);
}

struct Pool {
	std::vector<uint32_t> H, S, T, M, E, m, s, x;
};
static Pool g_pool;

static void load_pool() {
	std::ifstream in(opt.data + "/pool.txt");
	if(!in) {
		std::fprintf(stderr, "nduel: cannot read %s/pool.txt\n", opt.data.c_str());
		std::exit(2);
	}
	char kind;
	uint32_t code;
	while(in >> kind >> code) {
		switch(kind) {
		case 'H': g_pool.H.push_back(code); break;
		case 'S': g_pool.S.push_back(code); break;
		case 'T': g_pool.T.push_back(code); break;
		case 'M': g_pool.M.push_back(code); break;
		case 'E': g_pool.E.push_back(code); break;
		case 'm': g_pool.m.push_back(code); break;
		case 's': g_pool.s.push_back(code); break;
		case 'x': g_pool.x.push_back(code); break;
		}
	}
}

static const uint32_t TYPE_EXTRA_MASK = TYPE_FUSION | TYPE_SYNCHRO | TYPE_XYZ | TYPE_LINK;

struct Deck {
	std::vector<uint32_t> main, extra;
};

static Deck build_deck(Rng& rng) {
	Deck d;
	const int main_size = rng.range(40, 45);
	std::map<uint32_t, int> count;
	auto add = [&](uint32_t code) {
		auto it = g_cards.find(code);
		if(it == g_cards.end()) return;
		if(count[code] >= 3) return;
		if(it->second.d.type & TYPE_EXTRA_MASK) {
			if(d.extra.size() < 15) { d.extra.push_back(code); ++count[code]; }
			return;
		}
		if(static_cast<int>(d.main.size()) >= main_size) return;
		d.main.push_back(code);
		++count[code];
	};
	auto sample = [&](const std::vector<uint32_t>& pool, int k) {
		std::vector<uint32_t> copy = pool;
		rng.shuffle(copy);
		if(static_cast<int>(copy.size()) > k) copy.resize(k);
		return copy;
	};
	auto copies = [&]() { return rng.chance(0.55) ? 1 : (rng.chance(0.6) ? 2 : 3); };
	for(uint32_t c : sample(g_pool.H, rng.range(2, 5))) for(int i = copies(); i > 0; --i) add(c);
	for(uint32_t c : sample(g_pool.S, rng.range(6, 10))) for(int i = copies(); i > 0; --i) add(c);
	for(uint32_t c : sample(g_pool.T, rng.range(3, 6))) for(int i = copies(); i > 0; --i) add(c);
	for(uint32_t c : sample(g_pool.M, rng.range(6, 10))) for(int i = copies(); i > 0; --i) add(c);
	for(uint32_t c : g_pool.E) if(rng.chance(0.7)) add(c);
	int guard = 0;
	while(static_cast<int>(d.main.size()) < main_size && guard++ < 5000) {
		const auto& pool = rng.chance(0.6) ? g_pool.m : g_pool.s;
		if(pool.empty()) break;
		add(rng.pick(pool));
	}
	const int extra_target = rng.range(0, 10);
	guard = 0;
	while(static_cast<int>(d.extra.size()) < extra_target && guard++ < 200 && !g_pool.x.empty())
		add(rng.pick(g_pool.x));
	rng.shuffle(d.main);
	return d;
}

// ---------------------------------------------------------------------------------------------------------------
// Answers

static const int MSG_DUELIST_ELIMINATED = 200;
static const int MSG_ATTACK_DUELIST = 201;
static const int MSG_FIELD_DISABLED_N = 202;

struct Prompt {
	int id = 0;
	std::vector<uint8_t> payload;
	int player = -1;
	int place_seat = -1;  // seat named by the MSG_HINT 0xF0 right before a place prompt (n > 2), else -1
};

#ifndef HINT_PLACE_SEAT
#define HINT_PLACE_SEAT 0xF0  // same value as the constant of core patch 0045 (older trees do not have it)
#endif

static bool is_prompt(int id) {
	switch(id) {
	case MSG_SELECT_BATTLECMD: case MSG_SELECT_IDLECMD: case MSG_SELECT_EFFECTYN: case MSG_SELECT_YESNO:
	case MSG_SELECT_OPTION: case MSG_SELECT_CARD: case MSG_SELECT_CHAIN: case MSG_SELECT_PLACE:
	case MSG_SELECT_POSITION: case MSG_SELECT_TRIBUTE: case MSG_SORT_CHAIN: case MSG_SELECT_COUNTER:
	case MSG_SELECT_SUM: case MSG_SELECT_DISFIELD: case MSG_SORT_CARD: case MSG_SELECT_UNSELECT_CARD:
	case MSG_ROCK_PAPER_SCISSORS: case MSG_ANNOUNCE_RACE: case MSG_ANNOUNCE_ATTRIB: case MSG_ANNOUNCE_CARD:
	case MSG_ANNOUNCE_NUMBER:
		return true;
	}
	return false;
}

struct AnswerState {
	int turn_actions = 0;
	int toggle_steps = 0;
};
static AnswerState g_as;

static std::vector<uint32_t> distinct_indices(Rng& rng, size_t n, size_t k) {
	std::vector<uint32_t> idx(n);
	for(size_t i = 0; i < n; ++i) idx[i] = static_cast<uint32_t>(i);
	rng.shuffle(idx);
	idx.resize(std::min(k, n));
	return idx;
}

// Build the response for a card list selection (types 0..3 of parse_response_cards).
static Bytes cards_response(Rng& rng, const std::vector<uint32_t>& idx, size_t n) {
	Bytes b;
	int type = rng.range(0, 2);
	if(type == 2 && n >= 256) type = 0;
	if(rng.chance(0.15) && n <= 200) type = 3;
	b.put<int32_t>(0, type);
	if(type == 3) {
		b.pad(4 + (n + 7) / 8 + 1);
		for(uint32_t i : idx) b.v[4 + i / 8] |= static_cast<uint8_t>(1u << (i % 8));
		return b;
	}
	b.put<uint32_t>(4, static_cast<uint32_t>(idx.size()));
	for(size_t j = 0; j < idx.size(); ++j) {
		if(type == 0) b.put<uint32_t>(8 + 4 * j, idx[j]);
		else if(type == 1) b.put<uint16_t>(8 + 2 * j, static_cast<uint16_t>(idx[j]));
		else b.put<uint8_t>(8 + j, static_cast<uint8_t>(idx[j]));
	}
	return b;
}

static Bytes int32_response(int32_t v) {
	Bytes b;
	b.put<int32_t>(0, v);
	return b;
}

static int64_t eval_sum_check(const std::vector<int32_t>& oparam, int32_t size, int32_t index, int32_t acc) {
	if(acc == 0 || index == size) return 0;
	int32_t o1 = oparam[index] & 0xffff;
	int32_t o2 = oparam[index] >> 16;
	if(index == size - 1) return acc == o1 || acc == o2;
	return (acc > o1 && eval_sum_check(oparam, size, index + 1, acc - o1)) ||
	       (o2 > 0 && acc > o2 && eval_sum_check(oparam, size, index + 1, acc - o2));
}

static bool is_declarable(const OCG_CardData& cd, const std::vector<uint64_t>& opcodes) {
	std::vector<int64_t> st;
	bool alias = false, token = false;
	auto bin = [&](auto fn) {
		if(st.size() >= 2) { int64_t r = st.back(); st.pop_back(); int64_t l = st.back(); st.pop_back(); st.push_back(fn(l, r)); }
	};
	auto un = [&](auto fn) {
		if(st.size() >= 1) { int64_t v = st.back(); st.pop_back(); st.push_back(fn(v)); }
	};
	for(uint64_t op : opcodes) {
		switch(op) {
		case OPCODE_ADD: bin([](int64_t a, int64_t b) { return a + b; }); break;
		case OPCODE_SUB: bin([](int64_t a, int64_t b) { return a - b; }); break;
		case OPCODE_MUL: bin([](int64_t a, int64_t b) { return a * b; }); break;
		case OPCODE_DIV: bin([](int64_t a, int64_t b) { return b ? a / b : int64_t(0); }); break;
		case OPCODE_AND: bin([](int64_t a, int64_t b) { return int64_t(a && b); }); break;
		case OPCODE_OR: bin([](int64_t a, int64_t b) { return int64_t(a || b); }); break;
		case OPCODE_NEG: un([](int64_t a) { return -a; }); break;
		case OPCODE_NOT: un([](int64_t a) { return int64_t(!a); }); break;
		case OPCODE_BAND: bin([](int64_t a, int64_t b) { return a & b; }); break;
		case OPCODE_BOR: bin([](int64_t a, int64_t b) { return a | b; }); break;
		case OPCODE_BXOR: bin([](int64_t a, int64_t b) { return a ^ b; }); break;
		case OPCODE_BNOT: un([](int64_t a) { return ~a; }); break;
		case OPCODE_LSHIFT: bin([](int64_t a, int64_t b) { return (b >= 0 && b < 63) ? int64_t(uint64_t(a) << b) : int64_t(0); }); break;
		case OPCODE_RSHIFT: bin([](int64_t a, int64_t b) { return (b >= 0 && b < 63) ? int64_t(a >> b) : int64_t(0); }); break;
		case OPCODE_ISCODE: un([&](int64_t a) { return int64_t(cd.code == static_cast<uint32_t>(a)); }); break;
		case OPCODE_ISTYPE: un([&](int64_t a) { return int64_t(cd.type & a); }); break;
		case OPCODE_ISRACE: un([&](int64_t a) { return int64_t(cd.race & static_cast<uint64_t>(a)); }); break;
		case OPCODE_ISATTRIBUTE: un([&](int64_t a) { return int64_t(cd.attribute & a); }); break;
		case OPCODE_GETCODE: st.push_back(cd.code); break;
		case OPCODE_GETTYPE: st.push_back(cd.type); break;
		case OPCODE_GETRACE: st.push_back(static_cast<int64_t>(cd.race)); break;
		case OPCODE_GETATTRIBUTE: st.push_back(cd.attribute); break;
		case OPCODE_ISSETCARD:
			if(!st.empty()) {
				int32_t set_code = static_cast<int32_t>(st.back());
				st.pop_back();
				bool res = false;
				uint16_t settype = set_code & 0xfff, subtype = set_code & 0xf000;
				for(const uint16_t* sc = cd.setcodes; sc && *sc; ++sc)
					if((*sc & 0xfff) == settype && (*sc & 0xf000 & subtype) == subtype) { res = true; break; }
				st.push_back(res);
			}
			break;
		case OPCODE_ALLOW_ALIASES: alias = true; break;
		case OPCODE_ALLOW_TOKENS: token = true; break;
		default: st.push_back(static_cast<int64_t>(op)); break;
		}
	}
	if(st.size() != 1 || st.back() == 0) return false;
	return cd.code == 78734254u || cd.code == 13857930u ||
	       ((alias || !cd.alias) && (token || ((cd.type & (TYPE_MONSTER + TYPE_TOKEN)) != (TYPE_MONSTER + TYPE_TOKEN))));
}

static std::vector<int> team_of_seats();
static const std::vector<bool>* g_eliminated = nullptr;  // host view of eliminated seats (set in main), for the place fallback list

static Bytes answer_prompt(const Prompt& pr, int attempt) {
	Rng& rng = *g_rng;
	Reader r(pr.payload.data(), pr.payload.size(), pr.id);
	const uint8_t player = r.get<uint8_t>();
	const bool late = g_as.turn_actions > 40;
	const bool forced_exit = g_as.turn_actions > 150;
	switch(pr.id) {
	case MSG_SELECT_IDLECMD: {
		static const size_t sizes[6] = {10, 10, 7, 10, 10, 19};
		static const double wt[6] = {6, 6, 2, 3, 3, 5};
		uint32_t counts[6];
		for(int k = 0; k < 6; ++k) {
			counts[k] = r.get<uint32_t>();
			r.skip(counts[k] * sizes[k]);
		}
		const uint8_t bp = r.get<uint8_t>(), ep = r.get<uint8_t>(), shuffle = r.get<uint8_t>();
		std::vector<double> w;
		std::vector<int32_t> out;
		for(int k = 0; k < 6; ++k)
			for(uint32_t s = 0; s < counts[k]; ++s) {
				w.push_back(forced_exit || attempt > 0 ? 0 : wt[k]);
				out.push_back(k | (static_cast<int32_t>(s) << 16));
			}
		if(bp) { w.push_back(forced_exit ? 100 : (late ? 15 : 1.5)); out.push_back(6); }
		if(ep) { w.push_back(forced_exit ? 100 : (late ? 10 : 1)); out.push_back(7); }
		if(shuffle) { w.push_back(attempt > 0 ? 0 : 0.1); out.push_back(8); }
		double total = 0;
		for(double x : w) total += x;
		if(out.empty() || total <= 0) {
			if(ep) return int32_response(7);
			if(bp) return int32_response(6);
			return int32_response(out.empty() ? 7 : out[attempt % out.size()]);
		}
		return int32_response(out[rng.weighted(w)]);
	}
	case MSG_SELECT_BATTLECMD: {
		const uint32_t nc = r.get<uint32_t>();
		r.skip(nc * 19);
		const uint32_t na = r.get<uint32_t>();
		r.skip(na * 8);
		const uint8_t m2 = r.get<uint8_t>(), ep = r.get<uint8_t>();
		std::vector<double> w;
		std::vector<int32_t> out;
		for(uint32_t s = 0; s < nc; ++s) { w.push_back(forced_exit || attempt > 0 ? 0 : 4); out.push_back(0 | (static_cast<int32_t>(s) << 16)); }
		for(uint32_t s = 0; s < na; ++s) { w.push_back(forced_exit || attempt > 0 ? 0 : 8); out.push_back(1 | (static_cast<int32_t>(s) << 16)); }
		if(m2) { w.push_back(forced_exit ? 100 : (late ? 10 : 1)); out.push_back(2); }
		if(ep) { w.push_back(forced_exit ? 100 : (late ? 10 : 1)); out.push_back(3); }
		double total = 0;
		for(double x : w) total += x;
		if(out.empty() || total <= 0) {
			if(ep) return int32_response(3);
			if(m2) return int32_response(2);
			return int32_response(out.empty() ? 3 : out[attempt % out.size()]);
		}
		return int32_response(out[rng.weighted(w)]);
	}
	case MSG_SELECT_EFFECTYN:
	case MSG_SELECT_YESNO:
		return int32_response(attempt == 0 ? (rng.chance(0.55) ? 1 : 0) : attempt % 2);
	case MSG_SELECT_OPTION: {
		const uint8_t n = r.get<uint8_t>();
		return int32_response(n ? static_cast<int32_t>(attempt == 0 ? rng.below(n) : attempt % n) : 0);
	}
	case MSG_SELECT_CHAIN: {
		r.skip(2 + 8);
		const uint8_t forced = pr.payload[2];
		const uint32_t n = r.get<uint32_t>();
		if(!forced && (attempt > 0 || n == 0 || rng.chance(0.5))) return int32_response(-1);
		if(n == 0) return int32_response(-1);
		return int32_response(static_cast<int32_t>(attempt <= 1 ? rng.below(n) : (attempt % n)));
	}
	case MSG_SELECT_CARD: {
		const uint8_t cancelable = r.get<uint8_t>();
		uint32_t min = r.get<uint32_t>(), max = r.get<uint32_t>();
		const uint32_t n = r.get<uint32_t>();
		if(max > n) max = n;
		if(min > max) min = max;
		if(cancelable && (attempt == 2 || (attempt == 0 && min == 0 && rng.chance(0.25)))) return int32_response(-1);
		uint32_t k = attempt == 1 ? min : (rng.chance(0.55) ? min : static_cast<uint32_t>(rng.range(static_cast<int>(min), static_cast<int>(max))));
		std::vector<uint32_t> idx = distinct_indices(rng, n, k);
		if(attempt == 1) { idx.clear(); for(uint32_t i = 0; i < k; ++i) idx.push_back(i); }
		return cards_response(rng, idx, n);
	}
	case MSG_SELECT_UNSELECT_CARD: {
		const uint8_t finishable = r.get<uint8_t>(), cancelable = r.get<uint8_t>();
		r.skip(8);
		const uint32_t ns = r.get<uint32_t>();
		r.skip(ns * 14);
		const uint32_t nu = r.get<uint32_t>();
		const uint32_t total = ns + nu;
		++g_as.toggle_steps;
		const bool pressure = g_as.toggle_steps > 12;
		if((finishable || cancelable) && (pressure || total == 0 || rng.chance(finishable ? 0.4 : 0.1) || attempt >= 2)) return int32_response(-1);
		if(total == 0) return int32_response(-1);
		Bytes b;
		b.put<int32_t>(0, 1);
		uint32_t pick = attempt == 0 ? rng.below(total) : (attempt % total);
		if(ns > 0 && attempt == 0 && rng.chance(0.75)) pick = rng.below(ns);
		b.put<int32_t>(4, static_cast<int32_t>(pick));
		return b;
	}
	case MSG_SELECT_TRIBUTE: {
		const uint8_t cancelable = r.get<uint8_t>();
		const uint32_t min = r.get<uint32_t>(), max = r.get<uint32_t>();
		const uint32_t n = r.get<uint32_t>();
		std::vector<int> weight(n);
		for(uint32_t i = 0; i < n; ++i) { r.skip(4 + 1 + 1 + 4); weight[i] = r.get<uint8_t>(); }
		if(cancelable && (attempt == 2 || (attempt == 0 && rng.chance(0.15)))) return int32_response(-1);
		std::vector<uint32_t> order(n);
		for(uint32_t i = 0; i < n; ++i) order[i] = i;
		if(attempt % 2 == 0) rng.shuffle(order);
		else std::sort(order.begin(), order.end(), [&](uint32_t a, uint32_t b) { return weight[a] > weight[b]; });
		std::vector<uint32_t> picked;
		int sum = 0;
		for(uint32_t i : order) {
			if(sum >= static_cast<int>(min)) break;
			picked.push_back(i);
			sum += weight[i];
		}
		if(sum < static_cast<int>(min) || picked.size() > max) {
			std::sort(order.begin(), order.end(), [&](uint32_t a, uint32_t b) { return weight[a] > weight[b]; });
			picked.clear();
			sum = 0;
			for(uint32_t i : order) {
				if(sum >= static_cast<int>(min) || picked.size() >= max) break;
				picked.push_back(i);
				sum += weight[i];
			}
		}
		return cards_response(rng, picked, n);
	}
	case MSG_SELECT_SUM: {
		const uint8_t mode = r.get<uint8_t>();  // 0: exact-sum mode with min/max, 1: reach mode
		const int32_t acc = static_cast<int32_t>(r.get<uint32_t>());
		const uint32_t min = r.get<uint32_t>(), max = r.get<uint32_t>();
		const uint32_t nm = r.get<uint32_t>();
		std::vector<int32_t> must;
		for(uint32_t i = 0; i < nm; ++i) { r.skip(4 + 10); must.push_back(static_cast<int32_t>(r.get<uint32_t>())); }
		const uint32_t n = r.get<uint32_t>();
		std::vector<int32_t> param(n);
		for(uint32_t i = 0; i < n; ++i) { r.skip(4 + 10); param[i] = static_cast<int32_t>(r.get<uint32_t>()); }
		auto valid = [&](const std::vector<uint32_t>& sel) {
			const int32_t tot = static_cast<int32_t>(sel.size());
			std::vector<int32_t> op = must;
			for(uint32_t i : sel) op.push_back(param[i]);
			if(mode == 0) {
				if(tot < static_cast<int32_t>(min) || tot > static_cast<int32_t>(max)) return false;
				return eval_sum_check(op, tot + static_cast<int32_t>(nm), 0, acc) != 0;
			}
			int32_t sum = 0, mx = 0, mn = 0x7fffffff;
			for(int32_t p : op) {
				int32_t o1 = p & 0xffff, o2 = p >> 16;
				int32_t ms = (o2 && o2 < o1) ? o2 : o1;
				sum += ms;
				mx += (o2 > o1) ? o2 : o1;
				if(ms < mn) mn = ms;
			}
			return !(mx < acc || sum - mn >= acc);
		};
		std::vector<std::vector<uint32_t>> found;
		if(n <= 14) {
			for(uint32_t mask = 0; mask < (1u << n) && found.size() < 400; ++mask) {
				std::vector<uint32_t> sel;
				for(uint32_t i = 0; i < n; ++i) if(mask & (1u << i)) sel.push_back(i);
				if(valid(sel)) found.push_back(sel);
			}
		} else {
			for(int t = 0; t < 4000 && found.size() < 200; ++t) {
				auto sel = distinct_indices(rng, n, static_cast<size_t>(rng.range(1, std::min<int>(static_cast<int>(n), 6))));
				std::sort(sel.begin(), sel.end());
				if(valid(sel)) found.push_back(sel);
			}
		}
		if(!found.empty()) return cards_response(rng, found[attempt == 0 ? rng.below(static_cast<uint32_t>(found.size())) : attempt % found.size()], n);
		return cards_response(rng, distinct_indices(rng, n, std::max<uint32_t>(1, min)), n);
	}
	case MSG_SELECT_COUNTER: {
		r.skip(2);
		uint16_t count = r.get<uint16_t>();
		const uint32_t n = r.get<uint32_t>();
		std::vector<uint16_t> cap(n);
		for(uint32_t i = 0; i < n; ++i) { r.skip(4 + 3); cap[i] = r.get<uint16_t>(); }
		Bytes b;
		std::vector<uint32_t> order = distinct_indices(rng, n, n);
		std::vector<uint16_t> take(n, 0);
		int remaining = count;
		for(uint32_t i : order) {
			int t = std::min<int>(cap[i], remaining);
			if(attempt == 0 && !rng.chance(0.5)) t = std::min<int>(t, rng.range(0, cap[i]));
			take[i] = static_cast<uint16_t>(t);
			remaining -= t;
		}
		for(uint32_t i : order) {
			if(remaining <= 0) break;
			int add = std::min<int>(cap[i] - take[i], remaining);
			take[i] = static_cast<uint16_t>(take[i] + add);
			remaining -= add;
		}
		for(uint32_t i = 0; i < n; ++i) b.put<int16_t>(2 * i, static_cast<int16_t>(take[i]));
		b.pad(2 * std::max<uint32_t>(n, 1));
		return b;
	}
	case MSG_SELECT_POSITION: {
		r.skip(4);
		const uint8_t positions = r.get<uint8_t>() & 0xf;
		std::vector<int32_t> bits;
		for(int b = 1; b <= 8; b <<= 1) if(positions & b) bits.push_back(b);
		if(bits.empty()) return int32_response(1);
		return int32_response(bits[attempt == 0 ? rng.below(static_cast<uint32_t>(bits.size())) : attempt % bits.size()]);
	}
	case MSG_SELECT_PLACE:
	case MSG_SELECT_DISFIELD: {
		const uint8_t count = r.get<uint8_t>();
		uint32_t flag = r.get<uint32_t>();
		// Free bits: low half = own side, high half = one opponent. mzone bits 0..6, szone bits 8..15.
		Bytes b;
		// Fallback list when the prompt has no seat hint: living seats of other teams only (a Tag partner is not an opponent).
		std::vector<int> opponents;
		{
			const std::vector<int> tm = team_of_seats();
			for(int p = 0; p < opt.n; ++p) if(tm[p] != tm[player] && !(g_eliminated && (*g_eliminated)[static_cast<size_t>(p)])) opponents.push_back(p);
			if(opponents.empty()) for(int p = 0; p < opt.n; ++p) if(p != player && tm[p] != tm[player]) opponents.push_back(p);
			if(opponents.empty()) opponents.push_back(player ^ 1);
		}
		// A place prompt that came with a seat hint (MSG_HINT 0xF0) is answered on that seat. The core accepts no other seat.
		const bool hinted = pr.place_seat >= 0 && pr.place_seat < opt.n && pr.place_seat != player;
		const int opp = hinted ? pr.place_seat : opponents[static_cast<size_t>(attempt) % opponents.size()];
		for(int i = 0; i < count; ++i) {
			std::vector<uint32_t> free_bits;
			for(uint32_t bit = 0; bit < 32; ++bit) {
				const uint32_t half = bit & 15;
				const bool mz = half < 8;
				if(mz && half > 6) continue;
				if(!(flag & (1u << bit))) free_bits.push_back(bit);
			}
			if(free_bits.empty()) { b.pad(static_cast<size_t>(count) * 3); return b; }
			uint32_t bit = (!hinted && static_cast<size_t>(attempt) >= opponents.size()) ? free_bits[attempt % free_bits.size()] : rng.pick(free_bits);
			const bool own = bit < 16;
			const uint32_t half = bit & 15;
			b.put<uint8_t>(3 * i, static_cast<uint8_t>(own ? player : opp));
			b.put<uint8_t>(3 * i + 1, half < 8 ? LOCATION_MZONE : LOCATION_SZONE);
			b.put<uint8_t>(3 * i + 2, static_cast<uint8_t>(half < 8 ? half : half - 8));
			flag |= 1u << bit;
		}
		b.pad(static_cast<size_t>(count) * 3);
		return b;
	}
	case MSG_SORT_CHAIN:
	case MSG_SORT_CARD: {
		const uint32_t n = r.get<uint32_t>();
		Bytes b;
		if(attempt > 0 || rng.chance(0.4)) { b.put<int8_t>(0, -1); return b; }
		std::vector<uint32_t> idx = distinct_indices(rng, n, n);
		for(uint32_t i = 0; i < n; ++i) b.put<uint8_t>(i, static_cast<uint8_t>(idx[i]));
		b.pad(1);
		return b;
	}
	case MSG_ANNOUNCE_RACE: {
		const uint8_t count = r.get<uint8_t>();
		const uint64_t avail = r.get<uint64_t>();
		std::vector<int> bits;
		for(int i = 0; i < 64; ++i) if(avail & (1ull << i)) bits.push_back(i);
		rng.shuffle(bits);
		uint64_t v = 0;
		for(int i = 0; i < count && i < static_cast<int>(bits.size()); ++i) v |= 1ull << bits[i];
		Bytes b;
		b.put<uint64_t>(0, v);
		return b;
	}
	case MSG_ANNOUNCE_ATTRIB: {
		const uint8_t count = r.get<uint8_t>();
		const uint32_t avail = r.get<uint32_t>();
		std::vector<int> bits;
		for(int i = 0; i < 32; ++i) if(avail & (1u << i)) bits.push_back(i);
		rng.shuffle(bits);
		uint32_t v = 0;
		for(int i = 0; i < count && i < static_cast<int>(bits.size()); ++i) v |= 1u << bits[i];
		return int32_response(static_cast<int32_t>(v));
	}
	case MSG_ANNOUNCE_CARD: {
		const uint8_t n = r.get<uint8_t>();
		std::vector<uint64_t> ops(n);
		for(uint8_t i = 0; i < n; ++i) ops[i] = r.get<uint64_t>();
		int skip = attempt;
		for(int t = 0; t < 20000; ++t) {
			uint32_t code = rng.pick(g_card_codes);
			auto it = g_cards.find(code);
			if(it != g_cards.end() && is_declarable(it->second.d, ops) && skip-- <= 0)
				return int32_response(static_cast<int32_t>(code));
		}
		return int32_response(0);
	}
	case MSG_ANNOUNCE_NUMBER: {
		const uint8_t n = r.get<uint8_t>();
		return int32_response(n ? static_cast<int32_t>(attempt == 0 ? rng.below(n) : attempt % n) : 0);
	}
	case MSG_ROCK_PAPER_SCISSORS:
		return int32_response(rng.range(1, 3));
	}
	fail("driver", "no answer for message " + std::to_string(pr.id));
	return Bytes{};
}

// ---------------------------------------------------------------------------------------------------------------
// Main

static uint64_t g_hash = 1469598103934665603ull;
static void hash_bytes(const uint8_t* p, size_t n) {
	for(size_t i = 0; i < n; ++i) { g_hash ^= p[i]; g_hash *= 1099511628211ull; }
}

static std::vector<int> team_of_seats() {
	std::vector<int> t(opt.n);
	for(int i = 0; i < opt.n; ++i) t[i] = opt.tag ? (i % 2) : i;
	return t;
}

int main(int argc, char** argv) {
	for(int i = 1; i < argc; ++i) {
		const std::string a = argv[i];
		auto need = [&]() -> std::string {
			if(i + 1 >= argc) { std::fprintf(stderr, "nduel: missing value for %s\n", a.c_str()); std::exit(2); }
			return argv[++i];
		};
		if(a == "--n") opt.n = std::stoi(need());
		else if(a == "--mode") opt.tag = need() == "tag";
		else if(a == "--seed") opt.seed = std::stoull(need());
		else if(a == "--turns") opt.turns = std::stoi(need());
		else if(a == "--lp") opt.lp = static_cast<uint32_t>(std::stoul(need()));
		else if(a == "--max-steps") opt.max_steps = std::stol(need());
		else if(a == "--stall-steps") opt.stall_steps = std::stol(need());
		else if(a == "--setup-always") opt.setup_always = true;
		else if(a == "--check-future") opt.check_future = true;
		else if(a == "--trace") opt.trace = true;
		else if(a == "--domain") opt.domain = true;
		else if(a == "--domain-lua") opt.domain_lua = need();
		else if(a == "--data") opt.data = need();
		else if(a == "--scripts") opt.scripts = need();
		else if(a == "--multi-scripts") opt.multi_scripts = need();
		else if(a == "--probe-overlay") opt.probe_overlay = true;
		else { std::fprintf(stderr, "nduel: unknown option %s\n", a.c_str()); return 2; }
	}
	if(opt.n < 2 || opt.n > 4 || (opt.tag && opt.n != 4)) {
		std::fprintf(stderr, "nduel: --n must be 2..4; --mode tag needs --n 4\n");
		return 2;
	}
	g_log_trace = opt.trace;
	load_cards();
	load_pool();
	index_scripts();
	Rng rng(opt.seed);
	g_rng = &rng;
	const int n = opt.n;
	const std::vector<int> teams = team_of_seats();
	const int first_attack_turn = n == 2 ? 2 : (opt.tag ? 4 : n);
	const bool multi = n > 2;
	if(multi) load_overlay();

	uint64_t s = opt.seed;
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	for(int i = 0; i < 4; ++i) options.seed[i] = splitmix(s) | 1;
	options.flags = DUEL_MODE_MR5;
	const uint32_t start_lp = opt.tag ? opt.lp * 2 : opt.lp;
	options.team1 = {start_lp, 5, 1};
	options.team2 = {start_lp, 5, 1};
	options.cardReader = on_read_card;
	options.scriptReader = on_read_script;
	options.logHandler = on_log;
	OCG_Duel duel = nullptr;
	if(OCG_CreateDuel(&duel, &options) != OCG_DUEL_CREATION_SUCCESS)
		fail("setup", "OCG_CreateDuel failed");
	auto load_named = [&](const char* name) {
		if(!on_read_script(nullptr, duel, name)) fail("setup", std::string("required script failed to load: ") + name);
	};
	load_named("constant.lua");
	load_named("utility.lua");
	// After utility.lua (and domain.lua), before any card exists. Never at n = 2.
	auto load_mp_utility = [&]() {
		if(!g_overlay_on) return;
		const long errors_before = g_script_errors;
		if(!OCG_LoadScript(duel, g_overlay_utility.data(), static_cast<uint32_t>(g_overlay_utility.size()), "mp-utility.lua") || g_script_errors != errors_before)
			fail("setup", "mp-utility.lua failed to load");
	};
	if(multi || opt.setup_always) {
		std::string lua = "Debug.SetupDuelists(" + std::to_string(n);
		for(int i = 0; i < n; ++i) lua += "," + std::to_string(teams[i]);
		lua += ")";
		const long errors_before = g_script_errors;
		if(!OCG_LoadScript(duel, lua.data(), static_cast<uint32_t>(lua.size()), "nduel-setup.lua") || g_script_errors != errors_before)
			fail("setup", "Debug.SetupDuelists failed: " + lua + " (core without SetupDuelists?)");
	}
	if(!opt.domain) load_mp_utility();
	// Decks come first and in seat order, as before: the RNG use is the same with or without --domain.
	std::vector<Deck> decks;
	for(int seat = 0; seat < n; ++seat) decks.push_back(build_deck(rng));
	if(opt.domain) {
		// Same order as engine.ts: domain.lua, then one Deck Master per seat (location 0x4000, face-up attack),
		// then the decks. The Deck Master is the first monster of the seat's main deck (the deck keeps its copy,
		// the harness does not check legality). Fallback: Blue-Eyes White Dragon.
		std::ifstream in(opt.domain_lua, std::ios::binary);
		if(!in) fail("setup", "cannot read " + opt.domain_lua);
		std::stringstream buf;
		buf << in.rdbuf();
		const std::string dl = buf.str();
		const long errors_before = g_script_errors;
		if(!OCG_LoadScript(duel, dl.data(), static_cast<uint32_t>(dl.size()), "domain.lua") || g_script_errors != errors_before)
			fail("setup", "domain.lua failed to load");
		load_mp_utility();
		for(int seat = 0; seat < n; ++seat) {
			uint32_t dm = 0;
			for(uint32_t c : decks[seat].main) {
				auto it = g_cards.find(c);
				if(it != g_cards.end() && (it->second.d.type & 0x1)) { dm = c; break; }
			}
			if(!dm) dm = 89631139;
			OCG_NewCardInfo info;
			std::memset(&info, 0, sizeof(info));
			info.team = static_cast<uint8_t>(seat);
			info.duelist = 0;
			info.code = dm;
			info.con = static_cast<uint8_t>(seat);
			info.loc = 0x4000;
			info.seq = 0;
			info.pos = POS_FACEUP_ATTACK;
			OCG_DuelNewCard(duel, &info);
		}
	}
	std::string lp_lua = "local t={}\nfor i=0," + std::to_string(n - 1) + " do t[#t+1]=Duel.GetLP(i) end\nDebug.Message('NDUEL_LP '..table.concat(t,','))";
	for(int seat = 0; seat < n; ++seat) {
		const Deck& deck = decks[seat];
		auto add = [&](uint32_t code, uint32_t loc) {
			OCG_NewCardInfo info;
			std::memset(&info, 0, sizeof(info));
			info.team = static_cast<uint8_t>(seat);
			info.duelist = 0;
			info.code = code;
			info.con = static_cast<uint8_t>(seat);
			info.loc = loc;
			info.seq = 0;
			info.pos = POS_FACEDOWN_DEFENSE;
			OCG_DuelNewCard(duel, &info);
		};
		for(uint32_t c : deck.main) add(c, LOCATION_DECK);
		for(uint32_t c : deck.extra) add(c, LOCATION_EXTRA);
	}
	{
		std::string shuffle = "local e=Effect.GlobalEffect()\ne:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)\ne:SetCode(EVENT_STARTUP)\ne:SetOperation(function(effect)\n";
		for(int i = 0; i < n; ++i) shuffle += "Duel.ShuffleDeck(" + std::to_string(i) + ")\n";
		shuffle += "effect:Reset()\nend)\nDuel.RegisterEffect(e,0)\n";
		if(!OCG_LoadScript(duel, shuffle.data(), static_cast<uint32_t>(shuffle.size()), "nduel-startup.lua"))
			fail("setup", "startup shuffle script failed");
	}
	if(opt.probe_overlay) {
		const std::string probe = "Debug.Message('NDUEL_PROBE MP_OVERLAY_ACTIVE='..tostring(MP_OVERLAY_ACTIVE))";
		OCG_LoadScript(duel, probe.data(), static_cast<uint32_t>(probe.size()), "nduel-probe.lua");
	}
	OCG_StartDuel(duel);

	// Run state.
	int turn = 0, turn_player = -1, phase = 0;
	std::vector<bool> eliminated(n, false);
	g_eliminated = &eliminated;
	int wins = 0, winner = -1;
	long attacks = 0, retries = 0, steps_since_turn = 0, idle_loops = 0;
	Prompt last_prompt;
	int attempt = 0;
	std::string stop_reason = "end";
	bool finished = false;

	// State of the multi-duelist order checks (all "future" checks, see the header comment).
	ResponseOrder response_order(n, opt.tag);
	bool seg_open = false;          // consecutive forced trigger links in progress
	bool last_opt_chain = false;    // the newest prompt was an optional SELECT_CHAIN: the link that follows is a chosen response, not a forced trigger
	int seg_prev_pos = -1;
	int pick_expect = -1;           // duelist picked in a direct-attack SELECT_OPTION
	auto trigger_pos = [&](int tpl, int p) {
		const int order4[4] = {0, 2, 1, 3};
		const int d = ((p - tpl) % n + n) % n;
		if(!opt.tag) return d;
		for(int i = 0; i < 4; ++i) if(order4[i] == d) return i;
		return d;
	};
	auto check_response = [&](const std::string& error) {
		if(!error.empty()) future_check("response-order", error);
	};
	auto alive_after = [&](int p) {
		for(int k = 1; k <= n; ++k) {
			int q = (p + k) % n;
			if(!eliminated[q]) return q;
		}
		return p;
	};
	auto query_lp = [&]() -> std::vector<long> {
		g_last_lp_line.clear();
		OCG_LoadScript(duel, lp_lua.data(), static_cast<uint32_t>(lp_lua.size()), "nduel-lp.lua");
		std::vector<long> v;
		std::istringstream ss(g_last_lp_line);
		std::string tok;
		while(std::getline(ss, tok, ',')) v.push_back(std::stol(tok));
		return v;
	};

	while(!finished) {
		if(g_step >= opt.max_steps) { stop_reason = "max-steps"; break; }
		const int status = OCG_DuelProcess(duel);
		uint32_t length = 0;
		const uint8_t* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(duel, &length));
		hash_bytes(buffer, length);
		struct M { int id; const uint8_t* p; size_t len; };
		std::vector<M> msgs;
		for(uint32_t off = 0; off + 4 <= length;) {
			uint32_t size = 0;
			std::memcpy(&size, buffer + off, 4);
			if(size == 0 || off + 4 + size > length) fail("msg-parse", "bad length prefix at offset " + std::to_string(off));
			msgs.push_back({buffer[off + 4], buffer + off + 5, size - 1});
			off += 4 + size;
		}
		for(const M& m : msgs) {
			Reader mr(m.p, m.len, m.id);
			if(opt.trace) std::fprintf(stderr, "msg %d len %zu\n", m.id, m.len);
			switch(m.id) {
			case MSG_NEW_TURN: {
				const int tp = mr.get<uint8_t>();
				++turn;
				steps_since_turn = 0;
				g_as.turn_actions = 0;
				g_as.toggle_steps = 0;
				phase = 0;
				response_order.reset(); seg_open = false; pick_expect = -1;
				if(tp >= n) fail("turn-order", "turn player " + std::to_string(tp) + " out of range");
				if(turn_player >= 0) {
					const int expected = alive_after(turn_player);
					if(tp != expected) {
						const std::string d = "turn " + std::to_string(turn) + " player " + std::to_string(tp) + " expected " + std::to_string(expected);
						if(multi) future_check("turn-order", d);
						else fail("turn-order", d);
					}
				} else if(tp != 0 && !multi) {
					fail("turn-order", "first turn player is " + std::to_string(tp));
				}
				if(eliminated[tp]) future_check("eliminated-turn", "turn " + std::to_string(turn) + " for eliminated duelist " + std::to_string(tp));
				turn_player = tp;
				if(turn > opt.turns) { stop_reason = "turns"; finished = true; }
				break;
			}
			case MSG_NEW_PHASE:
				phase = mr.get<uint16_t>();
				break;
			case MSG_DRAW: {
				const int p = mr.get<uint8_t>();
				const uint32_t count = mr.get<uint32_t>();
				if(turn == 1 && phase == PHASE_DRAW && p == turn_player && count > 0)
					fail("first-turn-draw", "duelist " + std::to_string(p) + " drew " + std::to_string(count) + " in the Draw Phase of turn 1");
				break;
			}
			case MSG_ATTACK: {
				++attacks;
				if(turn < first_attack_turn) {
					const std::string d = "attack on turn " + std::to_string(turn) + " before first attack turn " + std::to_string(first_attack_turn);
					if(multi) future_check("first-attack", d);
					else fail("first-attack", d);
				}
				break;
			}
			case MSG_CHAINING: {
				mr.skip(4 + 10);
				const int L = mr.get<uint8_t>();
				check_response(response_order.chaining(L, turn_player));
				if(multi && L < n) {
					if(last_opt_chain) {
						seg_open = false;
					} else {
						const int pos = trigger_pos(turn_player, L);
						if(seg_open && pos < seg_prev_pos)
							future_check("segoc-order", "forced trigger link by " + std::to_string(L) + " after a later duelist, turn player " + std::to_string(turn_player));
						seg_prev_pos = pos;
						seg_open = true;
					}
				}
				last_opt_chain = false;
				break;
			}
			case MSG_CHAIN_SOLVING:
				check_response(response_order.solving(turn_player));
				seg_open = false;
				break;
			case MSG_CHAIN_END:
#ifdef NDUEL_CHAIN_END_HOOK
				NDUEL_CHAIN_END_HOOK(response_order);
#endif
				check_response(response_order.end(turn_player));
				seg_open = false;
				last_opt_chain = false;
				break;
			case MSG_MOVE: {
				mr.skip(4 + 10);
				const int con = mr.get<uint8_t>(), loc = mr.get<uint8_t>();
				if(multi && con < n && eliminated[con] && (loc & (LOCATION_MZONE | LOCATION_SZONE)))
					future_check("eliminated-cards", "card moved onto the field of eliminated duelist " + std::to_string(con));
				break;
			}
			case MSG_SET:
			case MSG_SUMMONING:
			case MSG_SPSUMMONING: {
				mr.skip(4);
				const int con = mr.get<uint8_t>(), loc = mr.get<uint8_t>();
				if(multi && con < n && eliminated[con] && (loc & (LOCATION_MZONE | LOCATION_SZONE)))
					future_check("eliminated-cards", "message " + std::to_string(m.id) + " for eliminated duelist " + std::to_string(con));
				break;
			}
			case MSG_ATTACK_DUELIST: {
				if(m.len != 1) future_check("msg-format", "MSG_ATTACK_DUELIST length " + std::to_string(m.len));
				const int d = mr.get<uint8_t>();
				if(d >= n || eliminated[d] || teams[d] == teams[turn_player < 0 ? 0 : turn_player])
					future_check("direct-pick", "attacked duelist " + std::to_string(d) + " is not a living opponent");
				else if(pick_expect >= 0 && d != pick_expect)
					future_check("direct-pick", "picked duelist " + std::to_string(pick_expect) + " but MSG_ATTACK_DUELIST names " + std::to_string(d));
				pick_expect = -1;
				break;
			}
			case MSG_FIELD_DISABLED_N: {
				const int cnt = mr.get<uint8_t>();
				if(m.len != static_cast<size_t>(1 + 5 * cnt)) {
					future_check("field-disabled-n", "length " + std::to_string(m.len) + " for count " + std::to_string(cnt));
					break;
				}
				for(int i = 0; i < cnt; ++i) {
					const int d = mr.get<uint8_t>();
					mr.get<uint32_t>();
					if(d >= n) future_check("field-disabled-n", "duelist " + std::to_string(d) + " not in play");
				}
				if(!multi) future_check("field-disabled-n", "sent with two duelists");
				break;
			}
			case MSG_DUELIST_ELIMINATED: {
				if(m.len != 2) future_check("msg-format", "MSG_DUELIST_ELIMINATED length " + std::to_string(m.len));
				const int p = mr.get<uint8_t>();
				if(p < n) {
					check_response(response_order.eliminate(p, turn_player));
					eliminated[p] = true;
				}
				break;
			}
			case MSG_WIN: {
				++wins;
				if(wins == 1) winner = mr.get<uint8_t>();
				break;
			}
			default:
				break;
			}
			if(is_prompt(m.id)) {
				// Refined when the answer is known (below): only a chosen response to an optional prompt exempts the next link.
				last_opt_chain = (m.id == MSG_SELECT_CHAIN && m.len >= 3 && !m.p[2] && m.p[1] != 0x7f);
				if(m.id == MSG_SELECT_CHAIN && m.len >= 3) {
					// spe_count 0x7f is the trigger window for the duelist's own new link, not a response prompt.
					response_order.prompt(m.p[0], m.p[1]);
					if(!m.p[2]) seg_open = false;
				} else {
					seg_open = false;
				}
			}
			if(m.id == MSG_SELECT_OPTION && multi && m.len >= 2) {
				const int cnt = m.p[1];
				bool all_direct = cnt > 0 && m.len == static_cast<size_t>(2 + 8 * cnt);
				std::vector<int> ds;
				for(int i = 0; all_direct && i < cnt; ++i) {
					uint64_t o;
					std::memcpy(&o, m.p + 2 + 8 * i, 8);
					if((o >> 16) != 0xFFFF) all_direct = false;
					else ds.push_back(static_cast<int>(o & 0xFFFF));
				}
				if(all_direct)
					for(int d : ds)
						if(d >= n || eliminated[d] || teams[d] == teams[m.p[0] < n ? m.p[0] : 0])
							future_check("direct-pick", "option lists duelist " + std::to_string(d) + " which is not a living opponent");
				// F5: the pick of one opponent at activation (desc 0xFFFE0000|seat): every option is a living opponent of the asker
				bool all_opp = cnt > 0 && m.len == static_cast<size_t>(2 + 8 * cnt);
				std::vector<int> os;
				for(int i = 0; all_opp && i < cnt; ++i) {
					uint64_t o;
					std::memcpy(&o, m.p + 2 + 8 * i, 8);
					if((o >> 16) != 0xFFFE) all_opp = false;
					else os.push_back(static_cast<int>(o & 0xFFFF));
				}
				if(all_opp) {
					const int asker = m.p[0] < n ? m.p[0] : 0;
					std::set<int> seen;
					for(int d : os) {
						if(d >= n || eliminated[d] || teams[d] == teams[asker])
							future_check("opponent-pick", "option lists duelist " + std::to_string(d) + " which is not a living opponent (a Tag partner and the asker count as not opponents)");
						else if(!seen.insert(d).second)
							future_check("opponent-pick", "option lists duelist " + std::to_string(d) + " twice");
					}
					// With one legal opponent the core binds it without a prompt, so a prompt needs a real choice.
					if(os.size() < 2)
						future_check("opponent-pick", "prompt for duelist " + std::to_string(asker) + " lists " + std::to_string(os.size()) + " option, the bind is silent with one opponent");
				}
			}
			if(is_prompt(m.id) && m.len >= 1) {
				const int p = m.p[0];
				if(p >= n && m.id != MSG_ROCK_PAPER_SCISSORS) fail("bad-player", "prompt " + std::to_string(m.id) + " for duelist " + std::to_string(p));
				if(p < n && eliminated[p]) future_check("eliminated-prompt", "prompt " + std::to_string(m.id) + " for eliminated duelist " + std::to_string(p));
			}
		}
		if(finished) break;
		// The core keeps running after MSG_WIN (and may repeat it inside one batch): the host ends the duel.
		if(wins > 0 || status == OCG_DUEL_STATUS_END) break;
		if(status == OCG_DUEL_STATUS_CONTINUE) {
			if(++idle_loops > 20000) fail("stall", "core returned CONTINUE 20000 times in a row");
			continue;
		}
		idle_loops = 0;
		// AWAITING: the last message is a prompt, or MSG_RETRY for the previous answer.
		if(msgs.empty()) fail("no-prompt", "core awaits a response but sent no message");
		const M& last = msgs.back();
		if(last.id == MSG_RETRY) {
			// A place prompt must be answered right the first time: with a seat hint the answer names the hinted seat.
			if(last_prompt.id == MSG_SELECT_PLACE || last_prompt.id == MSG_SELECT_DISFIELD)
				fail("place-retry", "message " + std::to_string(last_prompt.id) + " for duelist " + std::to_string(last_prompt.player) +
				     " rejected the answer (seat hint " + std::to_string(last_prompt.place_seat) + ")");
			++attempt;
			++retries;
			if(attempt > 60) fail("stuck-prompt", "message " + std::to_string(last_prompt.id) + " rejected " + std::to_string(attempt) + " answers");
		} else if(is_prompt(last.id)) {
			last_prompt.id = last.id;
			last_prompt.payload.assign(last.p, last.p + last.len);
			last_prompt.player = last.len ? last.p[0] : -1;
			last_prompt.place_seat = -1;
			if((last.id == MSG_SELECT_PLACE || last.id == MSG_SELECT_DISFIELD) && msgs.size() >= 2) {
				// MSG_HINT: u8 type, u8 player, u64 data. The hint comes right before the prompt, for the same duelist.
				const M& h = msgs[msgs.size() - 2];
				if(h.id == MSG_HINT && h.len == 10 && h.p[0] == HINT_PLACE_SEAT && h.p[1] == last_prompt.player) {
					uint64_t seat;
					std::memcpy(&seat, h.p + 2, 8);
					last_prompt.place_seat = seat < 255 ? static_cast<int>(seat) : -1;
				}
			}
			attempt = 0;
			if(last.id == MSG_SELECT_IDLECMD || last.id == MSG_SELECT_BATTLECMD) {
				++g_as.turn_actions;
				g_as.toggle_steps = 0;
				const std::vector<long> lp = query_lp();
				if(lp.size() == static_cast<size_t>(n)) {
					if(opt.tag) {
						for(int i = 0; i < n; ++i)
							if(lp[i] != lp[i % 2 == 0 ? (i + 2) % 4 : (i + 2) % 4]) {
								future_check("tag-lp", "partners " + std::to_string(i) + " and " + std::to_string((i + 2) % 4) + " show LP " + std::to_string(lp[i]) + " and " + std::to_string(lp[(i + 2) % 4]));
								break;
							}
					}
				} else {
					fail("lp-query", "GetLP returned '" + g_last_lp_line + "'");
				}
			}
		} else {
			std::string ids;
			for(const M& m : msgs) ids += std::to_string(m.id) + " ";
			fail("no-prompt", "core awaits a response but the last message is " + std::to_string(last.id) + " (messages: " + ids + ")");
		}
		if(++steps_since_turn > opt.stall_steps)
			fail("stall", std::to_string(opt.stall_steps) + " answers without a new turn (turn " + std::to_string(turn) + ")");
		const Bytes answer = answer_prompt(last_prompt, attempt);
		if(opt.trace) std::fprintf(stderr, "answer msg %d attempt %d len %zu\n", last_prompt.id, attempt, answer.v.size());
		if(last_prompt.id == MSG_SELECT_CHAIN && last_prompt.payload.size() >= 3) {
			// The next link is a chosen response only when the answer is not a pass (-1) and the window is not the
			// spe_count 0x7f trigger window of the duelist's own new link. A pass leaves the next link a forced trigger.
			int32_t idx = -1;
			if(answer.v.size() >= 4) std::memcpy(&idx, answer.v.data(), 4);
			last_opt_chain = !last_prompt.payload[2] && last_prompt.payload[1] != 0x7f && idx >= 0;
		}
		if(last_prompt.id == MSG_SELECT_OPTION && multi && last_prompt.payload.size() >= 2) {
			const int cnt = last_prompt.payload[1];
			int32_t idx = -1;
			if(answer.v.size() >= 4) std::memcpy(&idx, answer.v.data(), 4);
			pick_expect = -1;
			if(idx >= 0 && idx < cnt && last_prompt.payload.size() == static_cast<size_t>(2 + 8 * cnt)) {
				bool all_direct = true;
				uint64_t o = 0;
				for(int i = 0; i < cnt; ++i) {
					uint64_t v;
					std::memcpy(&v, last_prompt.payload.data() + 2 + 8 * i, 8);
					if((v >> 16) != 0xFFFF) all_direct = false;
					if(i == idx) o = v;
				}
				if(all_direct) pick_expect = static_cast<int>(o & 0xFFFF);
			}
		}
		OCG_DuelSetResponse(duel, answer.v.data(), static_cast<uint32_t>(answer.v.size()));
		++g_step;
	}
	if(stop_reason == "end") {
		if(wins < 1)
			fail("one-win", "duel ended without MSG_WIN");
		if(multi && wins != 1)
			future_check("one-win", "duel ended with " + std::to_string(wins) + " MSG_WIN messages in the last batch");
		if(multi && wins == 1) {
			int dead = 0;
			for(int i = 0; i < n; ++i) dead += eliminated[i] ? 1 : 0;
			// Tag: the core writes no MSG_DUELIST_ELIMINATED at the end, and MSG_WIN names the team (0 or 1), not a seat.
			const int expected_dead = opt.tag ? 0 : n - 1;
			const bool bad_winner = opt.tag ? (winner != 0 && winner != 1)
			                                : (winner >= 0 && winner < n && eliminated[winner]);
			if(dead != expected_dead || bad_winner)
				future_check("win-consistency", "eliminated " + std::to_string(dead) + " of " + std::to_string(n) + ", winner " + std::to_string(winner));
		}
	}
	std::string final_lp;
	if(stop_reason != "end") {
		for(long v : query_lp()) final_lp += (final_lp.empty() ? "" : ",") + std::to_string(v);
	}
	OCG_DestroyDuel(duel);
	long future_total = 0;
	for(auto& kv : g_future) future_total += kv.second;
	std::printf("NDUEL ok n=%d mode=%s seed=%llu turns=%d steps=%ld winner=%d hash=%016llx retries=%ld attacks=%ld scripterrors=%ld stop=%s future=%ld lp=%s\n",
		n, opt.tag ? "tag" : "ffa", static_cast<unsigned long long>(opt.seed), turn, g_step, stop_reason == "end" ? winner : -1,
		static_cast<unsigned long long>(g_hash), retries, attacks, g_script_errors, stop_reason.c_str(), future_total, final_lp.empty() ? "-" : final_lp.c_str());
	return 0;
}
