// FX2 native check: control check, old-rule duel flags and the effect owner compare for n > 2.
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh <check name> (see README.md).
// Modes (each is a separate process, so an ASan report in one does not hide the others):
//   seat2     IsAbleToChangeControler of a seat 2 monster (direct call and Lua), FFA4 and FFA3
//   seat3     the same for a seat 3 monster
//   control   the other control scenarios (seats 0 and 1, dead duelists, zone argument, ignore_mzone, Trap Monster, n = 2)
//   flags     SetupDuelists with the MR1..MR5 presets and with every single old-rule flag
//   n2        n = 2 with MR1: SetupDuelists(2,0,1) works and a short duel runs
//   effect    effect::is_target with ABSOLUTE_TARGET, FFA, effect_owner = none_id()
//   check     all of the above (exit 0 = pass)
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
#include "card.h"
#include "effect.h"
#include "common.h"

static std::string last_log;

static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	// Code 2 is an Extra Deck monster (Fusion). Code 3 is a Normal Spell. Every other code is a vanilla monster.
	if(code == 3) {
		data->type = TYPE_SPELL | TYPE_NORMAL;
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
static void on_log(void*, const char* text, int type) {
	last_log = text ? text : "";
	if(std::getenv("CHECK_LOG"))
		std::fprintf(stderr, "core log [%d]: %s\n", type, text);
}
static OCG_Duel make_duel(uint64_t flags, uint32_t seed = 1) {
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = seed;
	options.seed[1] = 2;
	options.seed[2] = 3;
	options.seed[3] = 4;
	options.flags = flags;
	options.team1 = {8000, 5, 1};
	options.team2 = {8000, 5, 1};
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel duel = nullptr;
	if(OCG_CreateDuel(&duel, &options) != OCG_DUEL_CREATION_SUCCESS) {
		std::printf("FAIL: OCG_CreateDuel\n");
		std::exit(2);
	}
	return duel;
}
static field& F(OCG_Duel d) { return *static_cast<duel*>(d)->game_field; }
static bool run_lua(OCG_Duel d, const std::string& code) {
	last_log.clear();
	return OCG_LoadScript(d, code.c_str(), static_cast<uint32_t>(code.size()), "check.lua") != 0;
}
static void add_card(OCG_Duel d, uint8_t con, uint32_t loc, uint32_t seq, uint32_t code = 1, uint32_t pos = POS_FACEUP_ATTACK) {
	OCG_NewCardInfo info;
	std::memset(&info, 0, sizeof(info));
	info.team = con;
	info.duelist = 0;
	info.code = code;
	info.con = con;
	info.loc = loc;
	info.seq = seq;
	info.pos = pos;
	OCG_DuelNewCard(d, &info);
}
static std::string setup_code(int n, const std::vector<int>& team) {
	std::string code = "Debug.SetupDuelists(" + std::to_string(n);
	for(int t : team)
		code += "," + std::to_string(t);
	return code + ")";
}

// ---------------------------------------------------------------- control check

// A board. n duelists in a free for all. Seat s has a monster at sequence 0 (the target of the check for the seat that
// is tested). Seats in full_mask also have monsters in zones 1 to 4 (all five Main Monster Zones used). Seats in
// full_szone_mask have a Spell in each of the five Spell and Trap Zones. Seats in dead_mask are eliminated.
struct Board {
	int n = 4;
	uint32_t full_mask = 0;
	uint32_t full_szone_mask = 0;
	uint32_t dead_mask = 0;
	uint64_t flags = DUEL_MODE_MR5;
};
static OCG_Duel make_board(const Board& b) {
	OCG_Duel d = make_duel(b.flags);
	std::vector<int> team;
	for(int i = 0; i < b.n; ++i)
		team.push_back(i);
	const bool ok = run_lua(d, setup_code(b.n, team));
	EXPECT(ok, "setup failed: %s", last_log.c_str());
	for(int p = 0; p < b.n; ++p) {
		const uint32_t count = (b.full_mask >> p & 1) ? 5 : 1;
		for(uint32_t seq = 0; seq < count; ++seq)
			add_card(d, static_cast<uint8_t>(p), LOCATION_MZONE, seq);
		if(b.full_szone_mask >> p & 1)
			for(uint32_t seq = 0; seq < 5; ++seq)
				add_card(d, static_cast<uint8_t>(p), LOCATION_SZONE, seq, 3);
	}
	for(int p = 0; p < b.n; ++p)
		if(b.dead_mask >> p & 1)
			F(d).player[p].eliminated = true;
	return d;
}
static card* mon(OCG_Duel d, int seat, int seq = 0) { return F(d).player[seat].list_mzone[seq]; }

// Direct call plus the Lua call for one board, target = the seq 0 monster of `seat`.
static void expect_control(const Board& b, int seat, bool want, const char* what, int ignore_mzone = 0, uint32_t zone = 0xff, bool lua = true) {
	OCG_Duel d = make_board(b);
	card* c = mon(d, seat);
	EXPECT(c && c->current.controler == seat && c->current.location == LOCATION_MZONE, "%s: no monster at seat %d", what, seat);
	if(!c) {
		OCG_DestroyDuel(d);
		return;
	}
	const bool got = c->is_control_can_be_changed(ignore_mzone, zone) != 0;
	EXPECT(got == want, "%s: seat %d direct call gave %d, want %d", what, seat, got, want);
	if(lua) {
		const std::string code = "local c=Duel.GetFieldCard(" + std::to_string(seat) + ",4,0) Debug.Message(tostring(c:IsControlerCanBeChanged(" +
			std::string(ignore_mzone ? "true" : "false") + "," + std::to_string(zone) + ")))";
		const bool ok = run_lua(d, code);
		EXPECT(ok, "%s: Lua call failed: %s", what, last_log.c_str());
		EXPECT(last_log == (want ? "true" : "false"), "%s: seat %d Lua gave '%s', want %s", what, seat, last_log.c_str(), want ? "true" : "false");
	}
	std::printf("ok   %-58s seat %d -> %s\n", what, seat, got ? "true" : "false");
	OCG_DestroyDuel(d);
}

// All scenarios of the seat that must not read out of bounds (2 or 3), in FFA4 and (seat 2) FFA3.
static void check_seat(int seat) {
	const uint32_t all = 0xF;
	const uint32_t others = all & ~(1u << seat);
	// FFA4: every other duelist has free zones.
	{ Board b; expect_control(b, seat, true, "FFA4: others have free zones"); }
	// Every other duelist has all five zones full.
	{ Board b; b.full_mask = others; expect_control(b, seat, false, "FFA4: no other duelist has a free zone"); }
	// Only one other duelist has a free zone (each in turn).
	for(int q = 0; q < 4; ++q) {
		if(q == seat)
			continue;
		Board b;
		b.full_mask = others & ~(1u << q);
		const std::string what = "FFA4: only seat " + std::to_string(q) + " has a free zone";
		expect_control(b, seat, true, what.c_str());
	}
	// The only free zones belong to an eliminated duelist.
	for(int q = 0; q < 4; ++q) {
		if(q == seat)
			continue;
		Board b;
		b.full_mask = others & ~(1u << q);
		b.dead_mask = 1u << q;
		const std::string what = "FFA4: the only free zones are on dead seat " + std::to_string(q);
		expect_control(b, seat, false, what.c_str());
	}
	// ignore_mzone = 1 skips the zone check (no Trap Monster).
	{ Board b; b.full_mask = others; expect_control(b, seat, true, "FFA4: ignore_mzone=1 with full zones", 1); }
	// The zone argument: seat 0 or 1 or the other seats have zone 0 used by the blocker, so a zone mask of only zone 0 fails.
	{ Board b; expect_control(b, seat, false, "FFA4: zone mask 0x01 (zone 0 is used everywhere)", 0, 0x01); }
	{ Board b; expect_control(b, seat, true, "FFA4: zone mask 0x02 (zone 1 is free)", 0, 0x02); }
	// Trap Monster: needs a Spell and Trap Zone too (the flag DUEL_TRAP_MONSTERS_NOT_USE_ZONE is off here).
	{
		Board b;
		b.flags = DUEL_MODE_MR5 & ~static_cast<uint64_t>(DUEL_TRAP_MONSTERS_NOT_USE_ZONE);
		OCG_Duel d = make_board(b);
		card* c = mon(d, seat);
		c->data.type |= TYPE_TRAPMONSTER;
		EXPECT(c->is_control_can_be_changed(0, 0xff) != 0, "trap monster, free zones: want true");
		OCG_DestroyDuel(d);
		Board b2 = b;
		b2.full_szone_mask = others;
		OCG_Duel d2 = make_board(b2);
		card* c2 = mon(d2, seat);
		c2->data.type |= TYPE_TRAPMONSTER;
		EXPECT(c2->is_control_can_be_changed(0, 0xff) == 0, "trap monster, every other Spell and Trap Zone full: want false");
		// One duelist has monster zones but no spell zone, another has spell zones but no monster zone: nobody passes both.
		Board b3 = b;
		const int q1 = (seat + 1) % 4, q2 = (seat + 2) % 4, q3 = (seat + 3) % 4;
		b3.full_mask = (1u << q1) | (1u << q3);
		b3.full_szone_mask = (1u << q2) | (1u << q3);
		// q1: monster zones full, spell zones free. q2: monster zones free, spell zones full. q3: both full.
		OCG_Duel d3 = make_board(b3);
		card* c3 = mon(d3, seat);
		c3->data.type |= TYPE_TRAPMONSTER;
		EXPECT(c3->is_control_can_be_changed(0, 0xff) == 0, "trap monster, no duelist passes both zone checks: want false");
		std::printf("ok   Trap Monster scenarios for seat %d\n", seat);
		OCG_DestroyDuel(d3);
		OCG_DestroyDuel(d2);
	}
	// FFA3 (seats 0..2): seat 2 has the other two duelists as targets.
	if(seat == 2) {
		{ Board b; b.n = 3; expect_control(b, seat, true, "FFA3: others have free zones"); }
		{ Board b; b.n = 3; b.full_mask = 0x3; expect_control(b, seat, false, "FFA3: no other duelist has a free zone"); }
		{ Board b; b.n = 3; b.full_mask = 0x1; expect_control(b, seat, true, "FFA3: only seat 1 has a free zone"); }
		{ Board b; b.n = 3; b.full_mask = 0x1; b.dead_mask = 0x2; expect_control(b, seat, false, "FFA3: the only free zones are on dead seat 1"); }
	}
	// A seat 2 or 3 monster in a Tag duel: the partner is another duelist; the opposing team is checked as well.
	{
		Board b;
		OCG_Duel d = make_duel(DUEL_MODE_MR5);
		EXPECT(run_lua(d, "Debug.SetupDuelists(4,0,1,0,1)"), "tag setup: %s", last_log.c_str());
		for(int p = 0; p < 4; ++p)
			add_card(d, static_cast<uint8_t>(p), LOCATION_MZONE, 0);
		card* c = mon(d, seat);
		EXPECT(c->is_control_can_be_changed(0, 0xff) != 0, "Tag seat %d with free zones: want true", seat);
		std::printf("ok   Tag layout, seat %d, free zones -> true\n", seat);
		OCG_DestroyDuel(d);
		(void)b;
	}
}

static void check_control() {
	// Seats 0 and 1 in FFA4 (they used opponent_of(0) = 1 and opponent_of(1) = 0 before: the wrong duelist only).
	for(int seat = 0; seat < 2; ++seat) {
		const uint32_t others = 0xF & ~(1u << seat);
		{ Board b; expect_control(b, seat, true, "FFA4: others have free zones"); }
		{ Board b; b.full_mask = others; expect_control(b, seat, false, "FFA4: no other duelist has a free zone", 0, 0xff, false); }
	}
	// Before the fix seat 0 only looked at seat 1: here seat 1 is full and seat 2 is free.
	{ Board b; b.full_mask = 0x2; expect_control(b, 0, true, "FFA4: seat 1 full, seats 2 and 3 free", 0, 0xff, false); }
	// n = 2 is unchanged: only the one opponent counts.
	for(int seat = 0; seat < 2; ++seat) {
		const int other = 1 - seat;
		for(int full = 0; full < 2; ++full) {
			OCG_Duel d = make_duel(DUEL_MODE_MR5);
			for(int p = 0; p < 2; ++p) {
				const int count = (p == other && full) ? 5 : 1;
				for(int s = 0; s < count; ++s)
					add_card(d, static_cast<uint8_t>(p), LOCATION_MZONE, static_cast<uint32_t>(s));
			}
			card* c = mon(d, seat);
			const bool got = c->is_control_can_be_changed(0, 0xff) != 0;
			EXPECT(got == !full, "n=2 seat %d opponent %s: gave %d", seat, full ? "full" : "free", got);
			// A used opponent zone 0 and the zone argument 0x01.
			EXPECT(!c->is_control_can_be_changed(0, 0x01), "n=2 zone mask 0x01");
			EXPECT(c->is_control_can_be_changed(0, 0x02) == !full, "n=2 zone mask 0x02");
			EXPECT(c->is_control_can_be_changed(1, 0xff) != 0, "n=2 ignore_mzone");
			std::printf("ok   n=2 seat %d, opponent %s -> %s\n", seat, full ? "full" : "free", got ? "true" : "false");
			OCG_DestroyDuel(d);
		}
	}
}

// ---------------------------------------------------------------- flags

struct Flag {
	const char* name;
	uint64_t bit;
};
static const Flag old_flags[] = {
	{ "DUEL_CANNOT_SUMMON_OATH_OLD", DUEL_CANNOT_SUMMON_OATH_OLD },
	{ "DUEL_SPSUMMON_ONCE_OLD_NEGATE", DUEL_SPSUMMON_ONCE_OLD_NEGATE },
	{ "DUEL_1_FACEUP_FIELD", DUEL_1_FACEUP_FIELD },
	{ "DUEL_INVERTED_QUICK_PRIORITY", DUEL_INVERTED_QUICK_PRIORITY },
	{ "DUEL_RELAY", DUEL_RELAY },
};
static uint64_t old_mask() {
	uint64_t m = 0;
	for(const auto& f : old_flags)
		m |= f.bit;
	return m;
}

static void check_flags() {
	struct Preset {
		const char* name;
		uint64_t flags;
		uint64_t ts_value; // the value of OcgDuelMode.MODE_* in the TS wrapper (ocgcore-wasm)
	};
	const Preset presets[] = {
		{ "MR1", DUEL_MODE_MR1, 0xd0700 },
		{ "MR2", DUEL_MODE_MR2, 0xd0600 },
		{ "MR3", DUEL_MODE_MR3, 0xd1800 },
		{ "MR4", DUEL_MODE_MR4, 0xd2800 },
		{ "MR5", DUEL_MODE_MR5, 0x2e800 },
		{ "GOAT", DUEL_MODE_GOAT, 0x3f80d072c },
		{ "SPEED", DUEL_MODE_SPEED, 0x620000 },
		{ "RUSH", DUEL_MODE_RUSH, 0x7f20200 },
	};
	struct Layout {
		int n;
		std::vector<int> team;
	};
	const Layout layouts[] = { { 2, { 0, 1 } }, { 3, { 0, 1, 2 } }, { 4, { 0, 1, 2, 3 } }, { 4, { 0, 1, 0, 1 } } };
	for(const auto& pr : presets) {
		// Only MR1 to MR5 are used by the TS host. The wrapper table is older for GOAT, SPEED and RUSH (they differ in bits it lacks).
		if(pr.name[0] == 'M')
			EXPECT(pr.flags == pr.ts_value, "%s: C++ value 0x%llx differs from the TS wrapper value 0x%llx", pr.name,
		       static_cast<unsigned long long>(pr.flags), static_cast<unsigned long long>(pr.ts_value));
		const uint64_t held = pr.flags & old_mask();
		std::string names;
		for(const auto& f : old_flags)
			if(held & f.bit)
				names += std::string(names.empty() ? "" : ",") + f.name;
		for(const auto& l : layouts) {
			OCG_Duel d = make_duel(pr.flags);
			const bool ok = run_lua(d, setup_code(l.n, l.team));
			const bool want_ok = l.n == 2 || held == 0;
			EXPECT(ok == want_ok, "%s %s: ok=%d want %d (%s)", pr.name, setup_code(l.n, l.team).c_str(), ok, want_ok, last_log.c_str());
			if(!ok) {
				// The error names one of the flags the preset holds.
				bool named = false;
				for(const auto& f : old_flags)
					if((held & f.bit) && last_log.find(f.name) != std::string::npos)
						named = true;
				EXPECT(named, "%s: the error does not name a flag: %s", pr.name, last_log.c_str());
				EXPECT(F(d).n_duelists == 2, "%s: n_duelists changed after the error", pr.name);
			} else
				EXPECT(F(d).n_duelists == l.n, "%s: n_duelists %d", pr.name, F(d).n_duelists);
			if(l.n == 3 || (l.n == 4 && l.team[2] == 2))
				std::printf("%-5s %-34s n=%d -> %s%s%s\n", pr.name, names.empty() ? "(no old-rule flag)" : names.c_str(), l.n, ok ? "no error" : "Lua error: ",
				            ok ? "" : last_log.c_str(), "");
			OCG_DestroyDuel(d);
		}
	}
	// Every old-rule flag alone (plus MR5): n = 2 works, n = 3, 4 (FFA) and Tag give an error that names the flag.
	for(const auto& f : old_flags) {
		for(const auto& l : layouts) {
			OCG_Duel d = make_duel(DUEL_MODE_MR5 | f.bit);
			const bool ok = run_lua(d, setup_code(l.n, l.team));
			EXPECT(ok == (l.n == 2), "%s n=%d: ok=%d (%s)", f.name, l.n, ok, last_log.c_str());
			if(!ok)
				EXPECT(last_log.find(f.name) != std::string::npos, "%s n=%d: the error does not name the flag: %s", f.name, l.n, last_log.c_str());
			OCG_DestroyDuel(d);
		}
		std::printf("ok   %s alone: n=2 accepted, n=3, n=4 FFA and n=4 Tag rejected with the flag name\n", f.name);
	}
}

// ---------------------------------------------------------------- n = 2 with MR1 still plays

static void check_n2() {
	for(int setup = 0; setup < 2; ++setup) {
		OCG_Duel d = make_duel(DUEL_MODE_MR1);
		if(setup == 1)
			EXPECT(run_lua(d, "Debug.SetupDuelists(2,0,1)"), "MR1 SetupDuelists(2,0,1): %s", last_log.c_str());
		for(uint8_t p = 0; p < 2; ++p) {
			for(int i = 0; i < 40; ++i)
				add_card(d, p, LOCATION_DECK, 0);
		}
		OCG_StartDuel(d);
		bool idle = false;
		for(int i = 0; i < 100 && !idle; ++i) {
			const int status = OCG_DuelProcess(d);
			uint32_t length = 0;
			const auto* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(d, &length));
			for(uint32_t offset = 0; offset + 4 <= length;) {
				uint32_t size = 0;
				std::memcpy(&size, buffer + offset, 4);
				if(size > 0 && buffer[offset + 4] == MSG_SELECT_IDLECMD)
					idle = true;
				offset += 4 + size;
			}
			if(status == OCG_DUEL_STATUS_END)
				break;
		}
		EXPECT(idle, "MR1 n=2 (setup %d): no idle prompt", setup);
		std::printf("ok   MR1, n=2, %s: no error, the duel reaches the first idle prompt (turn %d)\n",
		            setup ? "with SetupDuelists(2,0,1)" : "without SetupDuelists", F(d).infos.turn_id);
		OCG_DestroyDuel(d);
	}
}

// ---------------------------------------------------------------- effect owner compare

static void check_effect() {
	for(int n = 3; n <= 4; ++n) {
		OCG_Duel d = make_duel(DUEL_MODE_MR5);
		std::vector<int> team;
		for(int i = 0; i < n; ++i)
			team.push_back(i);
		EXPECT(run_lua(d, setup_code(n, team)), "setup: %s", last_log.c_str());
		for(int p = 0; p < n; ++p)
			add_card(d, static_cast<uint8_t>(p), LOCATION_MZONE, 0);
		auto* pd = static_cast<duel*>(d);
		const uint8_t none = F(d).none_id();
		// Owner card of the effect = the monster of seat 1. effect_owner stays none_id() (the value duel::new_effect sets).
		for(int owner_seat = 0; owner_seat < n; ++owner_seat) {
			effect* e = pd->new_effect();
			e->owner = e->handler = mon(d, owner_seat);
			EXPECT(e->effect_owner == none, "new effect owner %d is not none_id()", e->effect_owner);
			e->type = EFFECT_TYPE_FIELD;
			e->flag[0] = EFFECT_FLAG_ABSOLUTE_TARGET;
			e->s_range = LOCATION_MZONE;
			e->o_range = 0;
			std::string got;
			for(int p = 0; p < n; ++p)
				got += e->is_target(mon(d, p)) ? '1' : '0';
			std::string want(static_cast<size_t>(n), '0');
			want[static_cast<size_t>(owner_seat)] = '1';
			EXPECT(got == want, "n=%d owner card at seat %d, effect_owner none_id(): is_target per seat %s, want %s", n, owner_seat, got.c_str(), want.c_str());
			// A real effect_owner is used as before.
			e->effect_owner = static_cast<uint8_t>((owner_seat + 1) % n);
			std::string got2;
			for(int p = 0; p < n; ++p)
				got2 += e->is_target(mon(d, p)) ? '1' : '0';
			std::string want2(static_cast<size_t>(n), '0');
			want2[static_cast<size_t>((owner_seat + 1) % n)] = '1';
			EXPECT(got2 == want2, "n=%d effect_owner %d: is_target per seat %s, want %s", n, (owner_seat + 1) % n, got2.c_str(), want2.c_str());
			if(owner_seat == 1)
				std::printf("ok   n=%d owner card seat 1: effect_owner=none_id() -> is_target per seat %s; effect_owner=2 -> %s\n", n, got.c_str(), got2.c_str());
			pd->delete_effect(e);
		}
		OCG_DestroyDuel(d);
	}
}

int main(int argc, char** argv) {
	const std::string mode = argc > 1 ? argv[1] : "check";
	if(mode == "seat2" || mode == "check")
		check_seat(2);
	if(mode == "seat3" || mode == "check")
		check_seat(3);
	if(mode == "control" || mode == "check")
		check_control();
	if(mode == "flags" || mode == "check")
		check_flags();
	if(mode == "n2" || mode == "check")
		check_n2();
	if(mode == "effect" || mode == "check")
		check_effect();
	std::printf("%s: %d failure(s)\n", mode.c_str(), failures);
	return failures ? 1 : 0;
}
