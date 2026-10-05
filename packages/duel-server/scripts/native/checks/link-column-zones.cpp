// FX6 native check: Link and column zones at n > 2 (FFA4: SetupDuelists(4,0,1,2,3)).
// Every scenario runs in a forked child with an alarm, so a hang or a crash before the fix is reported, not fatal.
// Usage: check <zones|extralink> [n]   (n = 2, 3 or 4, default 4; exit 0 = pass)
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <unistd.h>
#include <sys/wait.h>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "common.h"

static std::string last_log;
static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	data->attribute = 1;
	data->race = 1;
	if(code >= 100) { // Link monsters: 100 all 8 arrows, 101 top, 102 bottom
		data->type = TYPE_MONSTER | TYPE_EFFECT | TYPE_LINK;
		data->level = code == 100 ? 8 : 1;
		data->attack = 1000;
		data->defense = 0;
		data->link_marker = code == 100 ? 0x1ef : (code == 101 ? LINK_MARKER_TOP : LINK_MARKER_BOTTOM);
	} else {
		data->type = TYPE_MONSTER | TYPE_NORMAL;
		data->level = 4;
		data->attack = 1000;
		data->defense = 1000;
	}
}
static int read_script(void*, OCG_Duel, const char*) { return 0; }
static void on_log(void*, const char* text, int) { last_log = text ? text : ""; }
static OCG_Duel make_duel() {
	OCG_DuelOptions o;
	std::memset(&o, 0, sizeof(o));
	o.seed[0] = 1; o.seed[1] = 2; o.seed[2] = 3; o.seed[3] = 4;
	o.flags = DUEL_MODE_MR5;
	o.team1 = {8000, 5, 1};
	o.team2 = {8000, 5, 1};
	o.cardReader = read_card;
	o.scriptReader = read_script;
	o.logHandler = on_log;
	OCG_Duel d = nullptr;
	if(OCG_CreateDuel(&d, &o) != OCG_DUEL_CREATION_SUCCESS) { std::printf("FAIL create\n"); std::exit(2); }
	return d;
}
static bool lua(OCG_Duel d, const std::string& code) {
	last_log.clear();
	return OCG_LoadScript(d, code.c_str(), (uint32_t)code.size(), "check.lua") != 0;
}
#undef EXPECT
#define EXPECT(c, ...) do { if(!(c)) { ++failures; std::printf("FAIL line %d: ", __LINE__); std::printf(__VA_ARGS__); std::printf("\n"); } } while(0)

// seat 2 board: X (102, bottom arrow) in the extra monster zone 5, Y (101, top arrow) at 1, Z (100, all arrows) at 2.
static OCG_Duel board(int n) {
	OCG_Duel d = make_duel();
	if(n > 2 && !lua(d, (n == 3 ? "Debug.SetupDuelists(3,0,1,2)" : "Debug.SetupDuelists(4,0,1,2,3)"))) { std::printf("FAIL setup: %s\n", last_log.c_str()); std::exit(2); }
	for(int p = 0; p < n; ++p) {
		for(int i = 0; i < 10; ++i) {
			OCG_NewCardInfo info; std::memset(&info, 0, sizeof(info));
			info.team = (uint8_t)p; info.code = 1; info.con = (uint8_t)p; info.loc = LOCATION_DECK; info.pos = POS_FACEDOWN_DEFENSE;
			OCG_DuelNewCard(d, &info);
		}
	}
	const char* s = n > 2 ? "2" : "0";
	std::string code = std::string("Debug.AddCard(102,") + s + "," + s + ",4,5,1)"
		+ "Debug.AddCard(101," + s + "," + s + ",4,1,1)"
		+ "Debug.AddCard(100," + s + "," + s + ",4,2,1)"
		+ "Debug.AddCard(1," + s + "," + s + ",4,0,1)"
		+ "Debug.ReloadFieldEnd()";
	if(!lua(d, code)) { std::printf("FAIL board: %s\n", last_log.c_str()); std::exit(2); }
	return d;
}
static void zones(int n) {
	OCG_Duel d = board(n);
	const int seats = n;
	struct Q { const char* name; const char* call; } qs[] = {
		{"GetLinkedZone", "c:GetLinkedZone(%d)"},
		{"GetFreeLinkedZone", "c:GetFreeLinkedZone(%d)"},
		{"GetMutualLinkedZone", "c:GetMutualLinkedZone(%d)"},
		{"GetColumnZone", "c:GetColumnZone(12,0,0,%d)"},
	};
	const int zseat = n > 2 ? 2 : 0;
	for(const auto& q : qs) {
		std::string row;
		uint32_t v[4] = {0, 0, 0, 0};
		for(int cp = 0; cp < seats; ++cp) {
			char buf[160]; std::snprintf(buf, sizeof(buf), q.call, cp);
			std::string code = std::string("local c=Duel.GetFieldCard(") + std::to_string(zseat) + ",4,2) Debug.Message(tostring(" + buf + "))";
			EXPECT(lua(d, code), "%s(%d): %s", q.name, cp, last_log.c_str());
			v[cp] = (uint32_t)std::strtoul(last_log.c_str(), nullptr, 10);
			char t[40]; std::snprintf(t, sizeof(t), " %08x", v[cp]); row += t;
		}
		std::printf("n=%d %-20s seats 0..%d:%s\n", n, q.name, seats - 1, row.c_str());
		if(n > 2) {
			for(int cp = 0; cp < n; ++cp) {
				if(cp == 2) {
					if(n == 3) EXPECT((v[cp] >> 16) == 0, "%s own seat has high bits %08x", q.name, v[cp]);
				} else if(n == 4 && cp == 3)
					EXPECT(v[cp] == (((v[2] & 0xffff) << 16) | (v[2] >> 16)), "%s facing partner mask differs", q.name);
				else EXPECT(v[cp] == 0, "%s seat %d is %08x, want 0", q.name, cp, v[cp]);
			}
		}
	}
	if(n > 2) {
		lua(d, "local c=Duel.GetFieldCard(2,4,2) Debug.Message(c:GetLinkedZone(2))");
		EXPECT(std::strtoul(last_log.c_str(), nullptr, 10) != 0, "own linked zone is empty");
		lua(d, "local c=Duel.GetFieldCard(2,4,2) Debug.Message(c:GetColumnZone(12,0,0,2))");
		EXPECT(std::strtoul(last_log.c_str(), nullptr, 10) != 0, "own column zone is empty");
	}
	OCG_DestroyDuel(d);
}
static void extralink(int n) {
	OCG_Duel d = board(n);
	const char* s = n > 2 ? "2" : "0";
	for(int seq : {5, 1, 2}) {
		std::string code = std::string("local c=Duel.GetFieldCard(") + s + ",4," + std::to_string(seq)
			+ ") Debug.Message(tostring(c:IsExtraLinked()) .. ' ' .. c:GetMutualLinkedGroupCount() .. ' ' .. c:GetLinkedGroupCount() .. ' ' .. tostring(c:IsLinked()) .. ' ' .. c:GetColumnGroupCount(0,0))";
		const bool ok = lua(d, code);
		std::printf("n=%d seq %d: IsExtraLinked MutualCount LinkedCount IsLinked ColumnCount = %s\n", n, seq, ok ? last_log.c_str() : "Lua error");
		EXPECT(ok, "Lua error: %s", last_log.c_str());
	}
	OCG_DestroyDuel(d);
}
int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "zones";
	const int n = argc > 2 ? std::atoi(argv[2]) : 4;
	alarm(20); // a hang ends as SIGALRM
	if(mode == "zones") zones(n);
	else if(mode == "extralink") extralink(n);
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
