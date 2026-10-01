// T6 native check: zones for n > 2 (no Extra Monster Zone mirror, per duelist disabled zones,
// MSG_FIELD_DISABLED_N, Duel.CheckTiming and Duel.IsEnvironment over living duelists).
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "duel.h"
#include "field.h"
#include "effect_constants.h"
#include "common.h"

static std::string last_log;

static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	if(code == 3) { // a Field Spell
		data->type = TYPE_SPELL | TYPE_FIELD;
		return;
	}
	data->type = TYPE_MONSTER | (code == 2 ? TYPE_FUSION : TYPE_NORMAL);
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
}
static int read_script(void*, OCG_Duel, const char*) { return 0; }
static void on_log(void*, const char* text, int) { last_log = text ? text : ""; }

static OCG_Duel make_duel() {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 1; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = {8000, 5, 1};
	options.team2 = {8000, 5, 1};
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel duel = nullptr;
	if(OCG_CreateDuel(&duel, &options) != OCG_DUEL_CREATION_SUCCESS) { std::printf("FAIL: OCG_CreateDuel\n"); std::exit(2); }
	return duel;
}
static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }
static bool run_lua(OCG_Duel d, const std::string& code) {
	last_log.clear();
	const bool ok = OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "check.lua") != 0;
	if(!ok) std::printf("lua error: %s\n", last_log.c_str());
	return ok;
}
static void add_cards(OCG_Duel d, uint8_t con, uint32_t loc, int count) {
	for(int i = 0; i < count; ++i) {
		OCG_NewCardInfo info;
		std::memset(&info, 0, sizeof(info));
		info.team = con; info.duelist = 0; info.code = 1; info.con = con; info.loc = loc; info.pos = POS_FACEDOWN_DEFENSE;
		OCG_DuelNewCard(d, &info);
	}
}
static std::string setup_code(int n, bool tag) {
	if(n == 2) return "";
	if(n == 3) return "Debug.SetupDuelists(3,0,1,2)";
	return tag ? "Debug.SetupDuelists(4,0,1,0,1)" : "Debug.SetupDuelists(4,0,1,2,3)";
}
struct Msg { uint8_t id; std::vector<uint8_t> payload; };
// Runs up to 'max_steps' process steps and returns every message that was sent.
static std::vector<Msg> run_start(OCG_Duel d, int max_steps = 6) {
	std::vector<Msg> out;
	OCG_StartDuel(d);
	for(int i = 0; i < max_steps; ++i) {
		const int status = OCG_DuelProcess(d);
		uint32_t length = 0;
		const auto* b = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
		for(uint32_t off = 0; off + 4 <= length;) {
			uint32_t size = 0;
			std::memcpy(&size, b + off, 4);
			if(size > 0) out.push_back({b[off + 4], std::vector<uint8_t>(b + off + 5, b + off + 4 + size)});
			off += 4 + size;
		}
		if(status != OCG_DUEL_STATUS_CONTINUE) break;
	}
	return out;
}
static uint32_t rd32(const std::vector<uint8_t>& v, size_t at) { uint32_t x; std::memcpy(&x, v.data() + at, 4); return x; }
static std::vector<const Msg*> find(const std::vector<Msg>& m, uint8_t id) {
	std::vector<const Msg*> r;
	for(const auto& x : m) if(x.id == id) r.push_back(&x);
	return r;
}
static std::string dump(const Msg& m) {
	std::string s;
	char buf[8];
	for(auto c : m.payload) { std::snprintf(buf, sizeof buf, "%02x", c); s += buf; }
	return s;
}
// The 202 body as a list of masks per duelist (-1 when the duelist is missing). Returns false on a bad layout.
static bool parse202(const Msg& m, int n, std::vector<int64_t>& masks) {
	masks.assign(MAX_DUELISTS, -1);
	if(m.payload.empty() || m.payload[0] != n || m.payload.size() != 1u + 5u * n) return false;
	for(int i = 0; i < n; ++i) {
		const uint8_t p = m.payload[1 + 5 * i];
		if(p != i) return false;
		masks[p] = rd32(m.payload, 2 + 5 * i);
	}
	return true;
}
static void fill_decks(OCG_Duel d, int n) {
	for(int p = 0; p < n; ++p) { add_cards(d, static_cast<uint8_t>(p), LOCATION_DECK, 40); }
}

// 1. EMZ: a monster in an EMZ of seat 2 blocks nothing of the other seats. n = 2 keeps the mirror.
static void check_emz(int n, bool tag) {
	OCG_Duel d = make_duel();
	if(n > 2) EXPECT(run_lua(d, setup_code(n, tag)), "setup");
	auto& f = F(d);
	const int mover = n > 2 ? 2 : 0;
	const uint8_t other_seq = 5;
	EXPECT(run_lua(d, "Debug.AddCard(1," + std::to_string(mover) + "," + std::to_string(mover) + ",4,5,1)"), "add");
	EXPECT(f.player[mover].list_mzone[5] != nullptr, "monster on EMZ 5 of seat %d", mover);
	for(int p = 0; p < n; ++p) {
		for(int seq : {5, 6}) {
			const bool useable = f.is_location_useable(static_cast<uint32_t>(p), LOCATION_MZONE, static_cast<uint32_t>(seq));
			bool want = true;
			if(p == mover && seq == 5) want = false;
			if(n == 2 && p == 1 && seq == 6) want = false; // the mirror of stock
			EXPECT(useable == want, "n=%d seat %d EMZ %d useable=%d want %d", n, p, seq, useable, want);
			EXPECT(!(f.player[p].disabled_location & 0x60), "n=%d seat %d disabled bits 5/6 set", n, p);
		}
	}
	// Seats 0, 1 and 3 can also get a monster on the same EMZ sequence (Debug.AddCard refuses a used or blocked zone).
	if(n > 2) {
		for(int p = 0; p < n; ++p) {
			if(p == mover) continue;
			EXPECT(run_lua(d, "Debug.AddCard(1," + std::to_string(p) + "," + std::to_string(p) + ",4," + std::to_string(other_seq) + ",1)"), "add seat %d", p);
			EXPECT(f.player[p].list_mzone[5] != nullptr, "n=%d monster placed on EMZ 5 of seat %d", n, p);
		}
		for(int p = 0; p < n; ++p) {
			EXPECT(f.player[p].disabled_location == 0, "n=%d seat %d disabled %x", n, p, f.player[p].disabled_location);
			EXPECT(f.is_location_useable(static_cast<uint32_t>(p), LOCATION_MZONE, 6), "n=%d seat %d EMZ 6 must stay free", n, p);
		}
	} else {
		// (Debug.AddCard into a blocked zone dereferences null in the stock core, so the zone test above is the check.)
		EXPECT(!f.is_location_useable(1, LOCATION_MZONE, 6) && f.is_location_useable(1, LOCATION_MZONE, 5), "n=2: mirror");
	}
	// get_spsummonable_count_fromex counts the free zones of seat 2 only (no call to opponent_of).
	if(n > 2) {
		for(int p = 0; p < n; ++p) {
			uint32_t list = 0;
			f.get_spsummonable_count_fromex_rule4(nullptr, static_cast<uint8_t>(p), static_cast<uint8_t>(p), 0xff, &list);
			(void)list;
		}
	}
	std::printf("ok   n=%d%s: EMZ %s\n", n, tag ? " tag" : "", n > 2 ? "of seat 2 blocks no other seat; every seat can use its own EMZ 5 and 6" : "mirror kept (seat 0 EMZ 5 blocks seat 1 EMZ 6)");
	OCG_DestroyDuel(d);
}

// 2. EFFECT_DISABLE_FIELD: message 202 with the right masks, no message 56.
static void check_disable(int n, bool tag, uint32_t value, int handler, const std::vector<int64_t>& want) {
	OCG_Duel d = make_duel();
	if(n > 2) EXPECT(run_lua(d, setup_code(n, tag)), "setup");
	fill_decks(d, n);
	char buf[256];
	std::snprintf(buf, sizeof buf, "local e=Effect.GlobalEffect() e:SetType(%d) e:SetCode(%d) e:SetValue(%u) Duel.RegisterEffect(e,%d)",
	              EFFECT_TYPE_FIELD, EFFECT_DISABLE_FIELD, value, handler);
	EXPECT(run_lua(d, buf), "register");
	const auto msgs = run_start(d);
	const auto m56 = find(msgs, MSG_FIELD_DISABLED);
	const auto m202 = find(msgs, MSG_FIELD_DISABLED_N);
	if(n > 2) {
		EXPECT(m56.empty(), "n=%d: MSG_FIELD_DISABLED must not be sent", n);
		EXPECT(m202.size() == 1, "n=%d: %zu messages 202", n, m202.size());
		if(m202.size() == 1) {
			std::vector<int64_t> masks;
			EXPECT(parse202(*m202[0], n, masks), "n=%d: bad layout %s", n, dump(*m202[0]).c_str());
			for(int p = 0; p < n; ++p)
				EXPECT(masks[p] == want[p], "n=%d seat %d mask %lx want %lx", n, p, static_cast<long>(masks[p]), static_cast<long>(want[p]));
			std::printf("ok   n=%d%s value %08x handler %d -> 202 layout %s\n", n, tag ? " tag" : "", value, handler, dump(*m202[0]).c_str());
		}
		auto& f = F(d);
		for(int p = 0; p < n; ++p)
			EXPECT(static_cast<int64_t>(f.player[p].disabled_location & 0xffff) == want[p], "n=%d seat %d field mask", n, p);
	} else {
		EXPECT(m202.empty(), "n=2: message 202 must not be sent");
		EXPECT(m56.size() == 1, "n=2: %zu messages 56", m56.size());
		if(m56.size() == 1) {
			EXPECT(m56[0]->payload.size() == 4 && static_cast<int64_t>(rd32(m56[0]->payload, 0)) == want[0], "n=2: MSG_FIELD_DISABLED %s want %lx", dump(*m56[0]).c_str(), static_cast<long>(want[0]));
			std::printf("ok   n=2 value %08x -> MSG_FIELD_DISABLED %s (stock layout, EMZ mirror applied)\n", value, dump(*m56[0]).c_str());
		}
	}
	OCG_DestroyDuel(d);
}

// 3. CheckTiming and IsEnvironment.
static void check_lua_libs(int n, bool tag) {
	OCG_Duel d = make_duel();
	if(n > 2) EXPECT(run_lua(d, setup_code(n, tag)), "setup");
	auto& f = F(d);
	const int last = n - 1;
	EXPECT(run_lua(d, "Debug.AddCard(3," + std::to_string(last) + "," + std::to_string(last) + ",256,0,5)"), "add field spell");
	EXPECT(f.player[last].list_szone[5] != nullptr, "field spell of seat %d", last);
	EXPECT(run_lua(d, "Debug.Message(tostring(Duel.IsEnvironment(3)))"), "IsEnvironment");
	EXPECT(last_log == "true", "n=%d: IsEnvironment sees the Field Spell of seat %d: %s", n, last, last_log.c_str());
	EXPECT(run_lua(d, "Debug.Message(tostring(Duel.IsEnvironment(4)))"), "IsEnvironment 4");
	EXPECT(last_log == "false", "n=%d: IsEnvironment of another code: %s", n, last_log.c_str());
	EXPECT(run_lua(d, "Debug.Message(tostring(Duel.IsEnvironment(3," + std::to_string(last) + ")))"), "IsEnvironment seat");
	// With n=4, PLAYER_ALL is 3 = the seat; the answer is true either way. With n=3 or 2 the seat is 2 (PLAYER_NONE) or 1.
	if(n == 4) EXPECT(last_log == "true", "IsEnvironment(3, seat 3): %s", last_log.c_str());
	// CheckTiming: hint_timing of the last living duelist only.
	f.core.hint_timing[last] = TIMING_DRAW;
	EXPECT(run_lua(d, "Debug.Message(tostring(Duel.CheckTiming(" + std::to_string(TIMING_DRAW) + ")))"), "CheckTiming");
	EXPECT(last_log == "true", "n=%d: CheckTiming sees hint_timing of seat %d: %s", n, last, last_log.c_str());
	if(n > 2) {
		f.player[last].eliminated = true;
		EXPECT(run_lua(d, "Debug.Message(tostring(Duel.CheckTiming(" + std::to_string(TIMING_DRAW) + ")))"), "CheckTiming elim");
		EXPECT(last_log == "false", "n=%d: CheckTiming skips an eliminated seat: %s", n, last_log.c_str());
		EXPECT(run_lua(d, "Debug.Message(tostring(Duel.IsEnvironment(3)))"), "IsEnvironment elim");
		EXPECT(last_log == "false", "n=%d: IsEnvironment skips an eliminated seat: %s", n, last_log.c_str());
		f.player[last].eliminated = false;
	}
	std::printf("ok   n=%d%s: IsEnvironment sees the Field Spell of seat %d; CheckTiming reads every living duelist\n", n, tag ? " tag" : "", last);
	OCG_DestroyDuel(d);
}

// 4. get_linked_zone: no mirror and no opponent_of for n > 2.
static void check_linked(int n, bool tag) {
	OCG_Duel d = make_duel();
	EXPECT(run_lua(d, setup_code(n, tag)), "setup");
	auto& f = F(d);
	char buf[256];
	std::snprintf(buf, sizeof buf, "local e=Effect.GlobalEffect() e:SetType(%d) e:SetCode(%d) e:SetValue(%u) Duel.RegisterEffect(e,2)",
	              EFFECT_TYPE_FIELD, EFFECT_BECOME_LINKED_ZONE, 0x00010003u);
	EXPECT(run_lua(d, buf), "register");
	const uint8_t next = static_cast<uint8_t>(3 % n);
	EXPECT((f.get_linked_zone(2) & 0xffff) == 3, "seat 2 linked zone %x", f.get_linked_zone(2));
	EXPECT((f.get_linked_zone(next) & 0xffff) == (next == 2 ? 3u : 1u), "seat %d linked zone %x", next, f.get_linked_zone(next));
	EXPECT(f.get_linked_zone(1) == 0, "seat 1 linked zone %x", f.get_linked_zone(1));
	card_set cs;
	f.get_linked_cards(0, LOCATION_ONFIELD, LOCATION_ONFIELD, &cs);
	std::printf("ok   n=%d%s: get_linked_zone uses own halves, get_linked_cards does not call opponent_of\n", n, tag ? " tag" : "");
	OCG_DestroyDuel(d);
}

int main() {
	// n = 2 first: the stock mirror, and the stock MSG_FIELD_DISABLED bytes.
	check_emz(2, false);
	// 0x00010003: seat 0 gets 3, seat 1 gets 1 (static value is absolute for 2 duelists).
	check_disable(2, false, 0x00010003u, 1, {0x00010003});
	// Seat 0 zone 5 -> the mirror gives seat 1 zone 6: 0x20 | (0x40 << 16).
	check_disable(2, false, 0x00000020u, 0, {0x00400020});
	check_lua_libs(2, false);
	for(int cfg = 0; cfg < 3; ++cfg) {
		const int n = cfg == 0 ? 3 : 4;
		const bool tag = cfg == 2;
		check_emz(n, tag);
		// Handler 2 disables its own zone 0 and zone 5 (an EMZ), and zone 0 of the next duelist in turn order.
		const uint32_t value = 0x00010021u;
		std::vector<int64_t> want(MAX_DUELISTS, 0);
		want[2] = 0x21;
		want[n == 3 ? 0 : 3] |= 0x1;
		check_disable(n, tag, value, 2, want);
		// Bound opponent bit 5 is an EMZ of that duelist only: no bit 6 on anybody.
		std::vector<int64_t> want2(MAX_DUELISTS, 0);
		want2[0] = 0x20;
		want2[1] = 0x1;
		check_disable(n, tag, 0x00010020u, 0, want2);
		check_lua_libs(n, tag);
		check_linked(n, tag);
	}
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
