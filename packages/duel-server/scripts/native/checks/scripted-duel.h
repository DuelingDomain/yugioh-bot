// Small shared harness for the F9 review checks (reset-self-turn, disfield-register): a duel with test cards whose Lua
// text and card type the check gives, a message parser, and one place to read every Debug.Message line.
// Not a check itself. Include it after common.h.
#pragma once
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
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
		for(const std::string root : { dir + "/", dir + "/official/" }) {
			std::ifstream in(root + base, std::ios::binary);
			if(!in) continue;
			std::stringstream buf;
			buf << in.rdbuf();
			text = buf.str();
			break;
		}
		if(text.empty()) return 0;
	}
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
inline OCG_Duel create(const std::string& setup, uint32_t seed = 1) {
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
