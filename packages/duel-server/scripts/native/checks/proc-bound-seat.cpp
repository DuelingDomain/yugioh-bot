// Native check: a summon procedure that puts the monster on an opponent's field binds one opponent (n > 2), for the
// Normal Summon codes too, and a bound seat that loses before the summon ends gives no summon.
// Build and run: bash packages/duel-server/scripts/native/checks/run.sh proc-bound-seat (see README.md).
// Real card scripts: The Winged Dragon of Ra - Sphere Mode (EFFECT_LIMIT_SUMMON_PROC, 3 Tributes) and Gameciel, the Sea
// Turtle Kaiju (EFFECT_SPSUMMON_PROC, 1 Tribute). Seat 0 acts. The harness answers every prompt with the first legal answer
// unless the scenario names one.
// Scenarios:
//   ra-one        FFA3: only seat 2 has 3 monsters (seat 1 has 2): no pick, no mixed Tribute, Ra on the field of seat 2
//   ra-two        FFA3: seats 1 and 2 have 3 monsters each: one pick (seats 1, 2), pick seat 2: Ra on seat 2, seat 1 is untouched
//   ra-mixed      FFA3: seats 1 and 2 have 2 monsters each: Ra is not offered (a mixed Tribute is not offered)
//   ra-ffa4       FFA4: seats 1 and 3 have 3 monsters, seat 2 has 1: pick (seats 1, 3), pick seat 3: Ra on seat 3
//   ra-tag        Tag (seats 1 and 3 are the opposing team): the same, Ra on the field of the picked seat
//   ra-n2         two duelists: no pick, Ra on the field of the other duelist (unchanged)
//   ra-dead       FFA3: seat 2 is picked and loses at the Tribute prompt: Ra stays in the hand of seat 0, no Ra on a field
//   kaiju-dead    FFA3 and FFA4: the same for Gameciel (the Kaiju procedure): the card stays in the hand, not in the Graveyard
#include "scripted-duel.h"
#include "card.h"
#include "effect.h"
#include "interpreter.h"

static const uint32_t kRa = 10000080;
static const uint32_t kGameciel = 55063751;
static const uint32_t kMon = 91003;
static const uint32_t kFiller = 5000;

template<typename T> static T rd(const uint8_t* p, size_t off) { T v; std::memcpy(&v, p + off, sizeof(T)); return v; }

struct Plan {
	const char* name = "";
	int n = 3;
	std::string setup;
	uint32_t card = kRa;
	std::vector<int> monsters;   // monsters per seat 1..n-1 (index 0 = seat 1)
	int pick_seat = -1;          // answer of the pick of the opponent
	int kill_seat = -1;          // eliminate this seat at the Tribute prompt
	int place_seat = 1;          // the seat whose field the zone prompt asks about (the bound opponent)
};
struct Result {
	bool offered = false, done = false;
	int picks = 0;
	std::vector<int> pick_seats;
	int mz[MAX_DUELISTS] = {};
	int card_on[MAX_DUELISTS] = {};   // the card on the field of seat s
	bool in_hand0 = false, in_grave0 = false;
	long lua_errors = 0;
};

static Result play(const Plan& pl) {
	Result r;
	sd::stray_logs = 0;
	sd::types[kRa] = TYPE_MONSTER | TYPE_EFFECT;
	sd::types[kGameciel] = TYPE_MONSTER | TYPE_EFFECT;
	OCG_Duel d = sd::create(pl.setup);
	for(int s = 0; s < pl.n; ++s)
		for(int i = 0; i < 30; ++i)
			sd::add(d, static_cast<uint8_t>(s), kFiller + s, LOCATION_DECK);
	sd::add(d, 0, pl.card, LOCATION_HAND);
	for(auto* c : sd::F(d).player[0].list_hand)   // the shared card reader gives every monster level 4
		if(c && c->data.code == pl.card) c->data.level = pl.card == kRa ? 10 : 8;
	for(size_t i = 0; i < pl.monsters.size(); ++i)
		for(int k = 0; k < pl.monsters[i]; ++k)
			sd::add(d, static_cast<uint8_t>(i + 1), kMon, LOCATION_MZONE, POS_FACEUP_ATTACK, static_cast<uint32_t>(k));
	OCG_StartDuel(d);
	bool acted = false, killed = false, picked_unselect = false;
	std::vector<sd::Msg> msgs;
	const sd::Msg* prompt = nullptr;
	for(int steps = 0; steps < 3000 && !r.done; ++steps) {
		const int status = sd::step(d, msgs, prompt);
		if(status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		if(!prompt) { std::printf("FAIL: awaiting without a prompt\n"); ++failures; break; }
		const sd::Msg& m = *prompt;
		const int who = m.p[0];
		if(std::getenv("CHECK_LOG")) std::fprintf(stderr, "[%s] prompt %u seat %d\n", pl.name, m.id, who);
		switch(m.id) {
		case MSG_SELECT_IDLECMD: {
			if(acted) { r.done = true; break; }
			if(who != 0) { sd::answer32(d, 7); break; }
			// lists: summon, special summon (entries of 10 bytes)
			size_t off = 1;
			const uint32_t ns = rd<uint32_t>(m.p, off);
			off += 4;
			int idx = -1;
			for(uint32_t i = 0; i < ns; ++i, off += 10)
				if(rd<uint32_t>(m.p, off) == pl.card) idx = static_cast<int>(i);
			int kind = 0;
			if(idx < 0) {
				const uint32_t nsp = rd<uint32_t>(m.p, off);
				off += 4;
				for(uint32_t i = 0; i < nsp; ++i, off += 10)
					if(rd<uint32_t>(m.p, off) == pl.card) idx = static_cast<int>(i);
				kind = 1;
			}
			if(idx < 0) { r.done = true; break; }
			r.offered = true;
			acted = true;
			sd::answer32(d, static_cast<int32_t>((idx << 16) | kind));
			break;
		}
		case MSG_SELECT_OPTION: {
			const int count = m.p[1];
			bool pick = count > 0;
			for(int i = 0; i < count; ++i)
				pick = pick && ((rd<uint64_t>(m.p, 2 + i * 8) >> 16) == 0xFFFE);
			int idx = 0;
			if(pick) {
				++r.picks;
				for(int i = 0; i < count; ++i) {
					const int seat = static_cast<int>(rd<uint64_t>(m.p, 2 + i * 8) & 0xFFFF);
					r.pick_seats.push_back(seat);
					if(seat == pl.pick_seat) idx = i;
				}
			}
			sd::answer32(d, idx);
			break;
		}
		case MSG_SELECT_UNSELECT_CARD: {
			// the Tribute of a Lava procedure (aux.SelectUnselectGroup): the seat loses here, then the first card
			if(pl.kill_seat >= 0 && !killed) {
				killed = true;
				sd::lua(d, "Debug.EliminateDuelist(" + std::to_string(pl.kill_seat) + ",0)");
			}
			if(m.p[1] != 0 && picked_unselect) { sd::answer32(d, -1); break; }
			picked_unselect = true;
			const uint32_t a[2] = { 1, 0 };
			OCG_DuelSetResponse(d, a, sizeof(a));
			break;
		}
		case MSG_SELECT_TRIBUTE:
		case MSG_SELECT_CARD: {
			if(pl.kill_seat >= 0 && !killed && m.id == MSG_SELECT_TRIBUTE) {
				killed = true;
				sd::lua(d, "Debug.EliminateDuelist(" + std::to_string(pl.kill_seat) + ",0)");
			}
			const uint32_t min = rd<uint32_t>(m.p, 2);
			std::vector<uint32_t> a{ 0, min };
			for(uint32_t i = 0; i < min; ++i) a.push_back(i);
			OCG_DuelSetResponse(d, a.data(), static_cast<uint32_t>(a.size() * 4));
			break;
		}
		case MSG_SELECT_POSITION: {
			const uint8_t pos = m.p[5];
			sd::answer32(d, (pos & 1) ? 1 : (pos & 2) ? 2 : (pos & 4) ? 4 : 8);
			break;
		}
		case MSG_SELECT_PLACE: {
			// the low half of the flag is the field of the chooser, the high half the field of the other side (the bound opponent)
			uint32_t flag = 0;
			std::memcpy(&flag, m.p + 2, 4);
			const bool own = (flag & 0x1f) != 0x1f;
			uint8_t seq = 0;
			for(int i = 0; i < 5; ++i)
				if(!(flag & (1u << (own ? i : 16 + i)))) { seq = static_cast<uint8_t>(i); break; }
			const uint8_t seat = own ? static_cast<uint8_t>(who) : static_cast<uint8_t>(pl.place_seat);
			if(std::getenv("CHECK_LOG")) std::fprintf(stderr, "  place flag %08x -> seat %d seq %d\n", flag, seat, seq);
			const uint8_t resp[3] = { seat, LOCATION_MZONE, seq };
			OCG_DuelSetResponse(d, resp, sizeof(resp));
			break;
		}
		case MSG_SELECT_YESNO: case MSG_SELECT_EFFECTYN: sd::answer32(d, 0); break;
		case MSG_SELECT_CHAIN: sd::answer32(d, -1); break;
		default:
			std::printf("FAIL: [%s] unexpected prompt %u (seat %d)\n", pl.name, m.id, who);
			++failures;
			r.done = true;
		}
	}
	auto& f = sd::F(d);
	for(int s = 0; s < pl.n; ++s) {
		r.mz[s] = sd::mzone_count(d, s);
		for(auto* c : f.player[s].list_mzone)
			if(c && c->data.code == pl.card) ++r.card_on[s];
	}
	for(auto* c : f.player[0].list_hand)
		if(c && c->data.code == pl.card) r.in_hand0 = true;
	for(auto* c : f.player[0].list_grave)
		if(c && c->data.code == pl.card) r.in_grave0 = true;
	r.lua_errors = sd::stray_logs;
	OCG_DestroyDuel(d);
	return r;
}

static void common(const char* name, const Result& r) {
	EXPECT(r.lua_errors == 0, "%s: %ld unexpected log line(s)", name, r.lua_errors);
}

int main() {
	const std::string ffa3 = "Debug.SetupDuelists(3,0,1,2)";
	const std::string ffa4 = "Debug.SetupDuelists(4,0,1,2,3)";
	const std::string tag = "Debug.SetupDuelists(4,0,1,0,1)";
	auto plan = [&](const char* name, int n, const std::string& setup, uint32_t card, std::vector<int> mons, int pick = -1, int kill = -1) {
		Plan p; p.name = name; p.n = n; p.setup = setup; p.card = card; p.monsters = std::move(mons); p.pick_seat = pick; p.kill_seat = kill;
		p.place_seat = pick >= 0 ? pick : 1;
		return p;
	};
	{ // Ra: only seat 2 can pay
		Plan p = plan("ra-one", 3, ffa3, kRa, { 2, 3 });
		p.place_seat = 2;
		const Result r = play(p);
		common(p.name, r);
		EXPECT(r.offered, "ra-one: Ra is not offered");
		EXPECT(r.picks == 0, "ra-one: %d pick prompt(s), want 0", r.picks);
		EXPECT(r.card_on[2] == 1 && r.card_on[0] == 0 && r.card_on[1] == 0, "ra-one: Ra on seats 0/1/2 = %d/%d/%d, want 0/0/1", r.card_on[0], r.card_on[1], r.card_on[2]);
		EXPECT(r.mz[1] == 2 && r.mz[2] == 1, "ra-one: monsters seat1=%d seat2=%d, want 2 and 1 (Ra only)", r.mz[1], r.mz[2]);
		std::printf("ra-one     FFA3: offered=%d picks=%d Ra on seat 2=%d, monsters seat1=%d seat2=%d\n", r.offered, r.picks, r.card_on[2], r.mz[1], r.mz[2]);
	}
	{ // Ra: both can pay, one pick
		const Plan p = plan("ra-two", 3, ffa3, kRa, { 3, 3 }, 2);
		const Result r = play(p);
		common(p.name, r);
		EXPECT(r.offered, "ra-two: Ra is not offered");
		EXPECT(r.picks == 1 && r.pick_seats == std::vector<int>({ 1, 2 }), "ra-two: %d pick prompt(s)", r.picks);
		EXPECT(r.card_on[2] == 1 && r.card_on[1] == 0 && r.card_on[0] == 0, "ra-two: Ra on seats 0/1/2 = %d/%d/%d, want 0/0/1", r.card_on[0], r.card_on[1], r.card_on[2]);
		EXPECT(r.mz[1] == 3 && r.mz[2] == 1, "ra-two: monsters seat1=%d seat2=%d, want 3 and 1", r.mz[1], r.mz[2]);
		std::printf("ra-two     FFA3: picks=%d Ra on seat 2=%d, monsters seat1=%d seat2=%d\n", r.picks, r.card_on[2], r.mz[1], r.mz[2]);
	}
	{ // Ra: 2 + 2 is not a Tribute of one opponent
		const Plan p = plan("ra-mixed", 3, ffa3, kRa, { 2, 2 });
		const Result r = play(p);
		common(p.name, r);
		EXPECT(!r.offered, "ra-mixed: Ra is offered with 2 monsters on each opponent");
		std::printf("ra-mixed   FFA3: offered=%d (must be 0)\n", r.offered);
	}
	{ // Ra: FFA4
		const Plan p = plan("ra-ffa4", 4, ffa4, kRa, { 3, 1, 3 }, 3);
		const Result r = play(p);
		common(p.name, r);
		EXPECT(r.picks == 1 && r.pick_seats == std::vector<int>({ 1, 3 }), "ra-ffa4: %d pick prompt(s)", r.picks);
		EXPECT(r.card_on[3] == 1 && r.card_on[1] == 0 && r.card_on[2] == 0 && r.card_on[0] == 0, "ra-ffa4: Ra on seats 0..3 = %d/%d/%d/%d, want 0/0/0/1", r.card_on[0], r.card_on[1], r.card_on[2], r.card_on[3]);
		EXPECT(r.mz[1] == 3 && r.mz[2] == 1 && r.mz[3] == 1, "ra-ffa4: monsters %d/%d/%d, want 3/1/1", r.mz[1], r.mz[2], r.mz[3]);
		std::printf("ra-ffa4    FFA4: picks=%d Ra on seat 3=%d, monsters %d/%d/%d\n", r.picks, r.card_on[3], r.mz[1], r.mz[2], r.mz[3]);
	}
	{ // Ra: Tag
		const Plan p = plan("ra-tag", 4, tag, kRa, { 3, 0, 3 }, 3);
		const Result r = play(p);
		common(p.name, r);
		EXPECT(r.picks == 1 && r.pick_seats == std::vector<int>({ 1, 3 }), "ra-tag: %d pick prompt(s)", r.picks);
		EXPECT(r.card_on[3] == 1 && r.card_on[1] == 0 && r.card_on[0] == 0 && r.card_on[2] == 0, "ra-tag: Ra on seats 0..3 = %d/%d/%d/%d, want 0/0/0/1", r.card_on[0], r.card_on[1], r.card_on[2], r.card_on[3]);
		EXPECT(r.mz[1] == 3 && r.mz[3] == 1, "ra-tag: monsters seat1=%d seat3=%d, want 3 and 1", r.mz[1], r.mz[3]);
		std::printf("ra-tag     Tag: picks=%d Ra on seat 3=%d, monsters seat1=%d seat3=%d\n", r.picks, r.card_on[3], r.mz[1], r.mz[3]);
	}
	{ // Ra: two duelists
		const Plan p = plan("ra-n2", 2, "", kRa, { 3 });
		const Result r = play(p);
		common(p.name, r);
		EXPECT(r.offered && r.picks == 0, "ra-n2: offered=%d picks=%d", r.offered, r.picks);
		EXPECT(r.card_on[1] == 1 && r.card_on[0] == 0 && r.mz[1] == 1, "ra-n2: Ra on seat 0/1 = %d/%d, monsters seat1=%d", r.card_on[0], r.card_on[1], r.mz[1]);
		std::printf("ra-n2      1v1: offered=%d Ra on seat 1=%d, monsters seat1=%d\n", r.offered, r.card_on[1], r.mz[1]);
	}
	{ // Ra: the bound seat loses at the Tribute prompt
		const Plan p = plan("ra-dead", 3, ffa3, kRa, { 3, 3 }, 2, 2);
		const Result r = play(p);
		common(p.name, r);
		EXPECT(r.picks == 1, "ra-dead: %d pick prompt(s)", r.picks);
		EXPECT(r.in_hand0 && !r.in_grave0, "ra-dead: Ra in hand=%d grave=%d, want hand only", r.in_hand0, r.in_grave0);
		EXPECT(r.card_on[0] == 0 && r.card_on[1] == 0, "ra-dead: Ra on a field: seat0=%d seat1=%d", r.card_on[0], r.card_on[1]);
		EXPECT(r.mz[1] == 3, "ra-dead: seat 1 has %d monsters, want 3", r.mz[1]);
		std::printf("ra-dead    FFA3: Ra in hand=%d grave=%d, seat1 monsters %d\n", r.in_hand0, r.in_grave0, r.mz[1]);
	}
	for(int n : { 3, 4 }) { // Gameciel: the bound seat loses at the Tribute prompt
		const char* name = n == 3 ? "kaiju-dead-ffa3" : "kaiju-dead-ffa4";
		std::vector<int> mons = n == 3 ? std::vector<int>{ 1, 2 } : std::vector<int>{ 1, 2, 1 };
		const Plan p = plan(name, n, n == 3 ? ffa3 : ffa4, kGameciel, mons, 2, 2);
		const Result r = play(p);
		common(p.name, r);
		EXPECT(r.picks == 1, "%s: %d pick prompt(s)", name, r.picks);
		EXPECT(r.in_hand0 && !r.in_grave0, "%s: Gameciel in hand=%d grave=%d, want hand only", name, r.in_hand0, r.in_grave0);
		int on_fields = 0;
		for(int s = 0; s < n; ++s) on_fields += r.card_on[s];
		EXPECT(on_fields == 0, "%s: Gameciel on %d field(s), want none", name, on_fields);
		EXPECT(r.mz[1] == 1, "%s: seat 1 has %d monsters, want 1", name, r.mz[1]);
		std::printf("%-16s Gameciel in hand=%d grave=%d, seat1 monsters %d\n", name, r.in_hand0, r.in_grave0, r.mz[1]);
	}
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
