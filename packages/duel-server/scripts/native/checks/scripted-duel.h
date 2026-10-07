// Small shared harness for the F9 review checks (reset-self-turn, disfield-register): a duel with test cards whose Lua
// text and card type the check gives, a message parser, and one place to read every Debug.Message line.
// Not a check itself. Include it after common.h.
#pragma once
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <map>
#include <sstream>
#include <string>
#include <vector>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "duel.h"
#include "field.h"
#include "common.h"

namespace sd {

inline std::map<uint32_t, std::string> scripts;   // card code -> Lua text of its script
inline std::map<uint32_t, uint32_t> types;        // card code -> card type (default: Normal Monster)
inline std::function<void(const std::string&)> on_line;  // every Debug.Message line, set by the check
inline int stray_logs = 0;                         // log lines that are not a Debug.Message of the check (Lua errors)
inline const char* msg_prefix = "CHK ";            // a Debug.Message line that starts with this is a line of the check

// Lua overlay (n > 2, design F7 section 4). Off unless a check passes overlay=true to create(): then mp-utility.lua is
// loaded after utility.lua and the setup call, a cNNN.lua of the overlay folder is appended to the original script
// of that card, and a file that starts with --@replace replaces it. The card list is the cNNN.lua files of the folder.
inline bool overlay_on = false;
inline std::string overlay_utility;
inline std::map<std::string, std::string> overlay_cards;   // "c123.lua" -> file text

inline bool read_whole(const std::string& path, std::string& out) {
	std::ifstream in(path, std::ios::binary);
	if(!in) return false;
	std::stringstream buf;
	buf << in.rdbuf();
	out = buf.str();
	return true;
}

inline bool load_overlay() {
	const std::string dir = check_multi_scripts_dir();
	if(!read_whole(dir + "/mp-utility.lua", overlay_utility)) return false;
	overlay_cards.clear();
	std::error_code ec;
	for(const auto& entry : std::filesystem::directory_iterator(dir, ec)) {
		const std::string file = entry.path().filename().string();
		if(!entry.is_regular_file() || file.size() < 6 || file[0] != 'c' || file.compare(file.size() - 4, 4, ".lua") != 0) continue;
		if(file.find_first_not_of("0123456789", 1) != file.size() - 4) continue;
		read_whole(entry.path().string(), overlay_cards[file]);
	}
	overlay_on = true;
	return true;
}

inline void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	const auto it = types.find(code);
	data->type = it != types.end() ? it->second : (TYPE_MONSTER | TYPE_NORMAL);
	data->level = (data->type & TYPE_MONSTER) ? 4 : 0;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
}

inline int read_script(void*, OCG_Duel duel, const char* name) {
	std::string n(name);
	std::replace(n.begin(), n.end(), '\\', '/');
	const auto slash = n.find_last_of('/');
	const std::string base = slash == std::string::npos ? n : n.substr(slash + 1);
	std::string text;
	if(base.size() > 5 && base[0] == 'c' && base.compare(base.size() - 4, 4, ".lua") == 0) {
		const auto it = scripts.find(static_cast<uint32_t>(std::strtoul(base.c_str() + 1, nullptr, 10)));
		if(it != scripts.end())
			text = it->second;
	}
	if(text.empty()) {
		const std::string dir = check_scripts_dir();
		for(const std::string root : { dir + "/", dir + "/official/", dir + "/pre-release/" }) {
			std::ifstream in(root + base, std::ios::binary);
			if(!in) continue;
			std::stringstream buf;
			buf << in.rdbuf();
			text = buf.str();
			break;
		}
		if(text.empty() && !(overlay_on && overlay_cards.count(base))) return 0;
	}
	if(overlay_on) {
		const auto card = overlay_cards.find(base);
		if(card != overlay_cards.end()) {
			if(card->second.compare(0, 10, "--@replace") == 0) text = card->second;
			else if(!text.empty()) text += (text.back() == '\n' ? "" : "\n") + card->second;
		}
	}
	// A suffix for a card without an original script is no script (the TS reader and nduel give none either).
	if(text.empty()) return 0;
	return OCG_LoadScript(duel, text.data(), static_cast<uint32_t>(text.size()), name);
}

inline void on_log(void*, const char* text, int) {
	const std::string t = text ? text : "";
	if(std::getenv("CHECK_LOG")) std::fprintf(stderr, "core log: %s\n", t.c_str());
	if(t.compare(0, std::strlen(msg_prefix), msg_prefix) == 0) {
		if(on_line) on_line(t);
	} else if(t.find("CallCardFunction") == std::string::npos) {
		++stray_logs;
	}
}

inline field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }

inline bool lua(OCG_Duel d, const std::string& code) {
	if(!OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "scripted-duel.lua")) {
		++failures;
		std::printf("FAIL: lua error in: %s\n", code.c_str());
		return false;
	}
	return true;
}

inline void add(OCG_Duel d, uint8_t seat, uint32_t code, uint32_t loc, uint32_t pos = POS_FACEDOWN_DEFENSE, uint32_t seq = 0) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = seat; info.con = seat; info.code = code; info.loc = loc; info.seq = seq; info.pos = pos;
	OCG_DuelNewCard(d, &info);
}

// A duel with Debug.SetupDuelists(setup) ("" keeps the stock 2-seat duel). Exits with 2 when the core cannot start.
// overlay=true loads the Lua overlay of duels with more than two seats (see load_overlay). Default false: stock scripts.
inline OCG_Duel create(const std::string& setup, uint32_t seed = 1, bool overlay = false) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = seed; options.seed[1] = 2; options.seed[2] = 3; options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = { 8000, 5, 1 };
	options.team2 = { 8000, 5, 1 };
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel d = nullptr;
	overlay_on = false;   // every duel decides for itself: an earlier create(..., true) must not leak into this one
	if(OCG_CreateDuel(&d, &options) != OCG_DUEL_CREATION_SUCCESS) {
		std::printf("FAIL: OCG_CreateDuel\n");
		std::exit(2);
	}
	for(const char* name : { "constant.lua", "utility.lua" })
		if(!read_script(nullptr, d, name)) {
			std::printf("FAIL: script %s not found\n", name);
			std::exit(2);
		}
	if(!setup.empty()) lua(d, setup);
	if(overlay) {
		if(!load_overlay()) {
			std::printf("FAIL: multi-scripts folder %s has no mp-utility.lua\n", check_multi_scripts_dir());
			std::exit(2);
		}
		lua(d, overlay_utility);
	}
	return d;
}

struct Msg { uint8_t id; const uint8_t* p; uint32_t len; };

// One OCG_DuelProcess call. Returns the status; fills msgs (valid until the next call) and the first prompt, if any.
inline int step(OCG_Duel d, std::vector<Msg>& msgs, const Msg*& prompt) {
	const int status = OCG_DuelProcess(d);
	uint32_t length = 0;
	const auto* buf = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
	msgs.clear();
	for(uint32_t off = 0; off + 4 <= length;) {
		uint32_t size = 0;
		std::memcpy(&size, buf + off, 4);
		if(size > 0) msgs.push_back({ buf[off + 4], buf + off + 5, size - 1 });
		off += 4 + size;
	}
	prompt = nullptr;
	for(const auto& x : msgs)
		if(x.id >= 10 && x.id <= 27 && x.id != 17) prompt = &x;
	return status;
}

inline void answer32(OCG_Duel d, int32_t v) { OCG_DuelSetResponse(d, &v, sizeof(v)); }

// The count of cards of a seat in a field list
inline int szone_count(OCG_Duel d, int seat) {
	int n = 0;
	for(auto* c : F(d).player[seat].list_szone) n += c != nullptr;
	return n;
}
inline int mzone_count(OCG_Duel d, int seat) {
	int n = 0;
	for(auto* c : F(d).player[seat].list_mzone) n += c != nullptr;
	return n;
}

}  // namespace sd
