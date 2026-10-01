// F7 part P2 native check: core seats at n = 3, n = 4 (free-for-all) and Tag. Synthetic scripts only (codes 91011..91013).
// Run it with the core library built with -DYGO_N_TRAP (the NFOLD records and the rebind trap are part of what it checks).
//
// Part H, hand scopes (a scope is pushed by hand, Lua is run in it):
//   MPNthDuelist   order from the scope player, an eliminated seat is skipped, the Tag partner counts, i out of range
//                  gives false and changes nothing, i = 0 puts P / bound / own_bound / window back, a rebind closes the
//                  window and the bound opponent (R1)
//   MPSeat         the real seat of a Lua value: own, bound, next opponent (NFOLD kind a), dead, Tag team key, outside a
//                  scope (R2)
//   MPSeatOf       the controller seat of a card, Tag too (R2)
//   MPBindSeat     a living opponent, a dead seat, a seat of the own team, a value that is no seat: the empty side, never
//                  another opponent; remove; the bind goes and comes back with a rebind (the 6 real-controller cards)
//   restore        a call (a filter that shares the scope) that ends normally, stops early, or ends with a Lua error leaves
//                  P, own_bound and the bind as they were (R2n); the trap build aborts when a call ends with a rebind open
//   flag           Tag: a flag effect counts for the team of its seat (get, label, reset); free for all and 1v1 keep the seat
// Part F, real flows (a Spell of seat 0 is activated, the harness answers the prompts):
//   global         an effect that Effect.GlobalEffect made in initial_effect sees the real rp / ep of the event (seat 2, 3);
//                  an effect of the card itself (a handler) keeps the fold
//   nth, bind      the rebind and the MPBindSeat bind survive a prompt in the function; the saved state is erased at the end
//   coerr          a Lua error in the coroutine after a prompt with a rebind open
//   n == 2 (part N2): every new function answers with the stock value, flags keep the seat
#include "scripted-duel.h"
#include <csignal>
#include <sys/wait.h>
#include <unistd.h>
#include "card.h"
#include "effect.h"
#include "interpreter.h"

static const uint32_t kFiller = 5000;
static const uint32_t kSpell = 91011;
static const uint32_t kMon = 91013;
static const uint32_t kQuick = 91012;
static const uint32_t kFlag = 91050;

// ---------------------------------------------------------------------------------------------- stderr capture
struct Cap {
	int fd = -1, saved = -1;
	std::string path;
	void begin() {
		path = check_tmp_template("f7-seats-stderr");
		fd = mkstemp(path.data());
		if(fd >= 0) {
			std::fflush(stderr);
			saved = dup(2);
			dup2(fd, 2);
		}
	}
	// the NFOLD lines; any other line goes on to the real stderr
	std::vector<std::string> end() {
		std::vector<std::string> out;
		if(fd < 0) return out;
		std::fflush(stderr);
		dup2(saved, 2);
		close(saved);
		close(fd);
		std::ifstream in(path);
		std::string line;
		while(std::getline(in, line)) {
			if(line.compare(0, 6, "NFOLD ") == 0) out.push_back(line);
			else std::fprintf(stderr, "%s\n", line.c_str());
		}
		unlink(path.c_str());
		fd = -1;
		return out;
	}
};
static int kind_count(const std::vector<std::string>& l, char kind) {
	int n = 0;
	for(const auto& s : l) if(s.size() > 6 && s[6] == kind) ++n;
	return n;
}

// ---------------------------------------------------------------------------------------------- the duel
struct Plan {
	std::string setup;
	int n = 3;
	bool tag = false;
	int mon[4] = { 0, 0, 0, 0 };
	int hand[4] = { 2, 2, 2, 2 };
};
static Plan ffa3() { Plan p; p.setup = "Debug.SetupDuelists(3,0,1,2)"; p.n = 3; return p; }
static Plan ffa4() { Plan p; p.setup = "Debug.SetupDuelists(4,0,1,2,3)"; p.n = 4; return p; }
static Plan tag4() { Plan p; p.setup = "Debug.SetupDuelists(4,0,1,0,1)"; p.n = 4; p.tag = true; return p; }
static std::string label(const Plan& pl) { return pl.tag ? "tag" : (pl.n == 3 ? "ffa3" : "ffa4"); }
static int team_of(const Plan& pl, int seat) { return pl.tag ? seat % 2 : seat; }

static OCG_Duel build(const Plan& pl) {
	sd::scripts[kMon] = "local s,id=GetID()\nfunction s.initial_effect(c) end\n";
	sd::types[kMon] = TYPE_MONSTER | TYPE_NORMAL;
	OCG_Duel d = sd::create(pl.setup);
	for(int p = 0; p < pl.n; ++p) {
		for(int i = 0; i < 30; ++i) sd::add(d, static_cast<uint8_t>(p), kFiller, LOCATION_DECK);
		for(int i = 0; i < pl.hand[p]; ++i) sd::add(d, static_cast<uint8_t>(p), kFiller, LOCATION_HAND);
		for(int i = 0; i < pl.mon[p]; ++i) sd::add(d, static_cast<uint8_t>(p), kMon, LOCATION_MZONE, POS_FACEUP_ATTACK, static_cast<uint32_t>(i));
	}
	return d;
}
static std::vector<int> opponents(const Plan& pl, int P = 0) {
	std::vector<int> v;
	for(int q = 0; q < pl.n; ++q) if(team_of(pl, q) != team_of(pl, P)) v.push_back(q);
	return v;
}
static std::string ints(const std::vector<int>& v) {
	std::string s;
	for(int x : v) s += (s.empty() ? "" : ",") + std::to_string(x);
	return s;
}
static std::string join(const std::vector<std::string>& v) {
	std::string s;
	for(const auto& x : v) s += (s.empty() ? "" : " ") + x;
	return s;
}

// ---------------------------------------------------------------------------------------------- Part H: by hand
struct Cfg {
	uint8_t P = 0;
	uint8_t own_bound = DUELIST_NONE;
	bool open = false;
};
struct Snap {
	uint8_t P = 0, own_bound = 0, seat_bind = 0;
	bool rb = false, mp_open = false, bound_null = true;
};
struct Hand {
	OCG_Duel d;
	interpreter* I;
	explicit Hand(OCG_Duel dd) : d(dd), I(static_cast<duel*>(dd)->lua) {}
	void push(const Cfg& c) {
		I->push_scope(c.P);
		auto* s = I->current_scope();
		s->own_bound = c.own_bound;
		s->mp.open = c.open;
	}
	void pop() { I->pop_scope(); }
	Snap snap() {
		auto* s = I->current_scope();
		Snap x;
		x.P = s->P; x.own_bound = s->own_bound; x.seat_bind = s->seat_bind;
		x.rb = s->rb.active; x.mp_open = s->mp.open; x.bound_null = s->bound == nullptr;
		return x;
	}
};
// Lua in a scope of the Cfg; the message lines come back, the scope is popped
static std::vector<std::string> lines(Hand& h, const Cfg& c, const std::string& code) {
	std::vector<std::string> out;
	sd::on_line = [&](const std::string& t) { out.push_back(t); };
	h.push(c);
	sd::lua(h.d, code);
	h.pop();
	sd::on_line = nullptr;
	return out;
}
// the text after "CHK <key> " of the first line with that key, or "<none>"
static std::string tail(const std::vector<std::string>& l, const std::string& key) {
	const std::string pre = "CHK " + key + " ";
	for(const auto& s : l) if(s.compare(0, pre.size(), pre) == 0) return s.substr(pre.size());
	return "<none>";
}
static const char* kLoop =
	"local t={} local i=1 while true do local ok,s=Duel.MPNthDuelist(i) if not ok then break end t[#t+1]=s i=i+1 end "
	"Duel.MPNthDuelist(0) Debug.Message('CHK seats '..table.concat(t,','))";

static void part_h(const Plan& pl) {
	const std::string f = label(pl);
	OCG_Duel d = build(pl);
	Hand h(d);
	auto& F = sd::F(d);
	Cap cap;
	cap.begin();
	const auto opp = opponents(pl);
	const uint8_t B = static_cast<uint8_t>(opp[1]);
	const uint8_t S = static_cast<uint8_t>(opp[0]);

	// ---- R1: MPNthDuelist order, dead seats, the partner
	auto want_order = [&](int P, int dead) {
		std::vector<int> v;
		for(int j = 0; j < pl.n; ++j) { const int q = (P + j) % pl.n; if(q != dead) v.push_back(q); }
		return ints(v);
	};
	for(int P = 0; P < pl.n; ++P) {
		Cfg c; c.P = static_cast<uint8_t>(P);
		const auto l = lines(h, c, kLoop);
		EXPECT(tail(l, "seats") == want_order(P, -1), "NthDuelist order [%s P=%d]: '%s', want '%s'", f.c_str(), P, tail(l, "seats").c_str(), want_order(P, -1).c_str());
	}
	for(int dead = 1; dead < pl.n; ++dead) {
		F.player[dead].eliminated = true;
		Cfg c;
		const auto l = lines(h, c, kLoop);
		EXPECT(tail(l, "seats") == want_order(0, dead), "NthDuelist, seat %d eliminated [%s]: '%s', want '%s'", dead, f.c_str(), tail(l, "seats").c_str(), want_order(0, dead).c_str());
		F.player[dead].eliminated = false;
	}
	{
		// the Tag partner (seat 2) counts as a duelist of its own in the loop
		Cfg c;
		const auto l = lines(h, c, kLoop);
		EXPECT(pl.tag ? tail(l, "seats").find('2') != std::string::npos : true, "NthDuelist: the Tag partner is counted [%s]", f.c_str());
	}
	// i out of range: false, nothing changes
	{
		Cfg c; c.own_bound = B;
		const auto l = lines(h, c, "local a,b=Duel.MPNthDuelist(" + std::to_string(pl.n + 1) + ") local c2=Duel.MPNthDuelist(-1) local d2=Duel.MPNthDuelist(1000) local e2=Duel.MPNthDuelist(256) Debug.Message('CHK range '..tostring(a)..' '..tostring(b)..' '..tostring(c2)..' '..tostring(d2)..' '..tostring(e2)..' '..tostring(Duel.MPNthDuelist(0)))");
		EXPECT(tail(l, "range") == "false nil false false false true", "NthDuelist out of range [%s]: '%s'", f.c_str(), tail(l, "range").c_str());
		h.push(c);
		sd::lua(h.d, "Duel.MPNthDuelist(" + std::to_string(pl.n + 1) + ")");
		const Snap x = h.snap();
		h.pop();
		EXPECT(!x.rb && x.P == 0 && x.own_bound == B, "NthDuelist out of range changes nothing [%s]", f.c_str());
	}
	// a rebind closes the window and the bound opponent; i = 0 gives them back
	{
		Cfg c; c.own_bound = B; c.open = true;
		h.push(c);
		sd::lua(h.d, "Duel.MPNthDuelist(2) Duel.MPBindSeat(" + std::to_string(S) + ")");
		const Snap in = h.snap();
		sd::lua(h.d, "Duel.MPNthDuelist(3)");
		sd::lua(h.d, "Duel.MPNthDuelist(0)");
		const Snap out = h.snap();
		h.pop();
		// the first Nth took the seat 1 (FFA) or 1 (Tag, the next duelist), the window and the bound opponent were cleared
		EXPECT(in.rb && in.P == 1 && !in.mp_open && in.own_bound == DUELIST_NONE && in.bound_null, "rebind state [%s]: rb %d P %d open %d own_bound %d", f.c_str(), in.rb, in.P, in.mp_open, in.own_bound);
		EXPECT(!out.rb && out.P == 0 && out.mp_open && out.own_bound == B && out.seat_bind == DUELIST_NONE, "rebind back [%s]: rb %d P %d open %d own_bound %d bind %d", f.c_str(), out.rb, out.P, out.mp_open, out.own_bound, out.seat_bind);
	}
	// i = 0 with no rebind: true, nothing changes. No scope: false.
	{
		Cfg c; c.own_bound = B;
		const auto l = lines(h, c, "Debug.Message('CHK zero '..tostring(Duel.MPNthDuelist(0)))");
		EXPECT(tail(l, "zero") == "true", "NthDuelist(0) with no rebind [%s]: '%s'", f.c_str(), tail(l, "zero").c_str());
		std::vector<std::string> o;
		sd::on_line = [&](const std::string& t) { o.push_back(t); };
		sd::lua(d, "Debug.Message('CHK noscope '..tostring(Duel.MPNthDuelist(1))..' '..tostring(Duel.MPBindSeat(1)))");
		sd::on_line = nullptr;
		EXPECT(tail(o, "noscope") == "false true", "no scope [%s]: '%s', want 'false true'", f.c_str(), tail(o, "noscope").c_str());
	}

	// ---- R2: MPSeat
	{
		Cfg c; c.own_bound = B;
		const auto l = lines(h, c, "Debug.Message('CHK seat '..Duel.MPSeat(0)..','..Duel.MPSeat(1)..','..Duel.MPSeat(2)..','..Duel.MPSeat(-1)..','..Duel.MPSeat(5))");
		const std::string want = pl.tag ? "0,1,-1,-1,-1" : "0," + std::to_string(B) + ",-1,-1,-1";
		EXPECT(tail(l, "seat") == want, "MPSeat, bound [%s]: '%s', want '%s'", f.c_str(), tail(l, "seat").c_str(), want.c_str());
	}
	for(int P = 1; P < pl.n; ++P) {
		Cfg c; c.P = static_cast<uint8_t>(P); c.own_bound = 0;
		const auto l = lines(h, c, "Debug.Message('CHK seatp '..Duel.MPSeat(0)..','..Duel.MPSeat(1))");
		// FFA: 0 is the scope player, 1 is the bound seat 0. Tag: the Lua values are the team ids
		const std::string want = pl.tag ? "0,1" : std::to_string(P) + ",0";
		EXPECT(tail(l, "seatp") == want, "MPSeat, P=%d [%s]: '%s', want '%s'", P, f.c_str(), tail(l, "seatp").c_str(), want.c_str());
	}
	if(!pl.tag) {
		// nothing bound: the next living opponent, one NFOLD kind a record, no prompt
		cap.end();
		cap.begin();
		Cfg c;
		auto l = lines(h, c, "Debug.Message('CHK next '..Duel.MPSeat(1))");
		const auto nf = cap.end();
		cap.begin();
		EXPECT(tail(l, "next") == "1", "MPSeat, nothing bound [%s]: '%s', want 1", f.c_str(), tail(l, "next").c_str());
#ifdef YGO_N_TRAP
		EXPECT(kind_count(nf, 'a') == 1, "MPSeat, nothing bound [%s]: %d trap a record(s), want 1", f.c_str(), kind_count(nf, 'a'));
#else
		(void)nf;
#endif
		F.player[1].eliminated = true;
		l = lines(h, c, "Debug.Message('CHK next '..Duel.MPSeat(1))");
		EXPECT(tail(l, "next") == "2", "MPSeat, seat 1 dead [%s]: '%s', want 2", f.c_str(), tail(l, "next").c_str());
		for(int q = 2; q < pl.n; ++q) F.player[q].eliminated = true;
		l = lines(h, c, "Debug.Message('CHK next '..Duel.MPSeat(1))");
		EXPECT(tail(l, "next") == "-1", "MPSeat, every opponent dead [%s]: '%s', want -1", f.c_str(), tail(l, "next").c_str());
		for(int q = 1; q < pl.n; ++q) F.player[q].eliminated = false;
	}
	{
		// outside a scope the value is a real seat: FFA the seat, Tag its team
		std::vector<std::string> o;
		sd::on_line = [&](const std::string& t) { o.push_back(t); };
		sd::lua(d, "local t={} for s=0," + std::to_string(pl.n) + " do t[#t+1]=Duel.MPSeat(s) end t[#t+1]=Duel.MPSeat(9) Debug.Message('CHK outside '..table.concat(t,','))");
		sd::on_line = nullptr;
		std::vector<int> w;
		for(int s = 0; s < pl.n; ++s) w.push_back(team_of(pl, s));
		w.push_back(-1);
		w.push_back(-1);
		EXPECT(tail(o, "outside") == ints(w), "MPSeat outside a scope [%s]: '%s', want '%s'", f.c_str(), tail(o, "outside").c_str(), ints(w).c_str());
	}
	// MPSeatOf: the controller seat, Tag too
	{
		std::vector<std::string> o;
		sd::on_line = [&](const std::string& t) { o.push_back(t); };
		sd::lua(d, "local seen={} local bad=0 for c in aux.Next(Duel.GetFieldGroup(0,LOCATION_MZONE,LOCATION_MZONE)) do local q=Duel.MPSeatOf(c) seen[q]=true if q~=c:GetControler() then bad=bad+1 end end local t={} for s=0," + std::to_string(pl.n - 1) + " do if seen[s] then t[#t+1]=s end end Debug.Message('CHK of '..table.concat(t,',')..' bad '..bad)");
		sd::on_line = nullptr;
		std::vector<int> w;
		for(int s = 0; s < pl.n; ++s) w.push_back(s);
		EXPECT(tail(o, "of") == ints(w) + " bad 0", "MPSeatOf [%s]: '%s', want '%s'", f.c_str(), tail(o, "of").c_str(), ints(w).c_str());
	}

	// ---- MPBindSeat: the individual read (a hand count) follows the bound seat
	{
		auto hand_of = [&](int q) { return static_cast<int>(F.player[q].list_hand.size()); };
		const std::string cnt = "Duel.GetFieldGroupCount(0,0,LOCATION_HAND)";
		Cfg c;
		auto one = [&](const std::string& code, const char* what, const std::string& want) {
			const auto l = lines(h, c, code);
			EXPECT(tail(l, "bs") == want, "MPBindSeat %s [%s]: '%s', want '%s'", what, f.c_str(), tail(l, "bs").c_str(), want.c_str());
		};
		auto code = [&](const std::string& arg) { return "local r=Duel.MPBindSeat(" + arg + ") Debug.Message('CHK bs '..tostring(r)..' '.." + cnt + ")"; };
		one(code(std::to_string(B)), "a living opponent", "true " + std::to_string(hand_of(B)));
		one(code(std::to_string(S)), "the first opponent", "true " + std::to_string(hand_of(S)));
		F.player[S].eliminated = true;
		one(code(std::to_string(S)), "a dead seat", "false 0");
		F.player[S].eliminated = false;
		one(code("0"), "the own seat", "false 0");
		if(pl.tag) one(code("2"), "the partner", "false 0");
		one(code("99"), "a value that is no seat", "false 0");
		one(code("-1"), "a negative value", "false 0");
		{
			// remove: back to the stock read (every opponent for the individual class, one record a)
			std::string want_all;
			int sum = 0;
			for(int q : opp) sum += hand_of(q);
			want_all = "true " + std::to_string(sum);
			one("Duel.MPBindSeat(" + std::to_string(B) + ") Duel.MPBindSeat() Debug.Message('CHK bs '..tostring(true)..' '.." + cnt + ")", "removed", want_all);
		}
		// a rebind takes the bind away, MPNthDuelist(0) brings it back
		{
			const auto l = lines(h, c, "Duel.MPBindSeat(" + std::to_string(B) + ") local a=" + cnt + " Duel.MPNthDuelist(2) local b=Duel.MPSeat(1) Duel.MPNthDuelist(0) local e=" + cnt + " Debug.Message('CHK bs '..a..' '..e)");
			EXPECT(tail(l, "bs") == std::to_string(hand_of(B)) + " " + std::to_string(hand_of(B)), "MPBindSeat and a rebind [%s]: '%s'", f.c_str(), tail(l, "bs").c_str());
		}
	}

	// ---- R2n: a call that shares the scope. A filter (no effect) runs in the scope of the caller.
	{
		Cfg c; c.own_bound = B;
		const std::string tailcode =
			" Debug.Message('CHK after '..Duel.MPSeat(0)..' '..tostring(Duel.MPBound())..' '..tostring(ok))";
		const auto probe = [&](const char* name, const std::string& filter) {
			sd::stray_logs = 0;
			const auto l = lines(h, c, "local ok=Duel.IsExistingMatchingCard(" + filter + ",0,LOCATION_MZONE,0,1,nil)" + tailcode);
			return std::make_pair(l, std::string(name));
		};
		const std::string want_p = "0";
		// normal end: the helper closes the rebind itself
		auto r1 = probe("normal", "function(c) local ok=Duel.MPNthDuelist(2) Duel.MPNthDuelist(0) return false end");
		EXPECT(tail(r1.first, "after").compare(0, 2, want_p + " ") == 0 && sd::stray_logs == 0, "restore, normal end [%s]: '%s' stray %d", f.c_str(), tail(r1.first, "after").c_str(), sd::stray_logs);
		// stop: the loop stops at the first duelist after the own one, then closes
		auto r2 = probe("stop", "function(c) local i=1 while true do local ok,s=Duel.MPNthDuelist(i) if not ok or i==2 then break end i=i+1 end Duel.MPNthDuelist(0) return false end");
		EXPECT(tail(r2.first, "after").compare(0, 2, want_p + " ") == 0 && sd::stray_logs == 0, "restore, stop [%s]: '%s' stray %d", f.c_str(), tail(r2.first, "after").c_str(), sd::stray_logs);
		// Lua error with the rebind open: logged, the scope of the caller is as it was (P, own_bound, bind)
		sd::stray_logs = 0;
		h.push(c);
		sd::lua(h.d, "Duel.MPBindSeat(" + std::to_string(S) + ") Duel.IsExistingMatchingCard(function(c) Duel.MPNthDuelist(2) error('boom') end,0,LOCATION_MZONE,0,1,nil)");
		const Snap x = h.snap();
		h.pop();
		EXPECT(sd::stray_logs >= 1, "restore, Lua error [%s]: the error was not logged", f.c_str());
		EXPECT(!x.rb && x.P == 0 && x.own_bound == B && x.seat_bind == S, "restore, Lua error [%s]: rb %d P %d own_bound %d bind %d", f.c_str(), x.rb, x.P, x.own_bound, x.seat_bind);
		sd::stray_logs = 0;
	}
	// a call that opens a rebind inside an open rebind of the caller: the caller keeps its own (P0 of the first Nth)
	{
		Cfg c;
		const auto l = lines(h, c, "Duel.MPNthDuelist(2) local ok=Duel.IsExistingMatchingCard(function(c) Duel.MPNthDuelist(3) Duel.MPNthDuelist(0) return false end,0,LOCATION_MZONE,0,1,nil) local _,k=Duel.MPNthDuelist(1) Duel.MPNthDuelist(0) Debug.Message('CHK nest '..k)");
		EXPECT(tail(l, "nest") == "0", "restore, nested rebind [%s]: P0 '%s', want 0", f.c_str(), tail(l, "nest").c_str());
	}

	// ---- Tag: the flag key is the team
	{
		std::vector<std::string> o;
		sd::on_line = [&](const std::string& t) { o.push_back(t); };
		const std::string k = std::to_string(kFlag);
		sd::lua(d, "local e=Duel.RegisterFlagEffect(2," + k + ",0,0,1,77) local t={} for s=0," + std::to_string(pl.n - 1) + " do t[#t+1]=Duel.GetFlagEffect(s," + k + ")..':'..tostring(Duel.GetFlagEffectLabel(s," + k + ")) end Debug.Message('CHK flag '..table.concat(t,','))");
		sd::on_line = nullptr;
		std::string got = tail(o, "flag");
		{
			// the label of "no flag" is the stock value of the core: compare to the seat that has none
			std::vector<std::string> parts;
			std::stringstream ss(got);
			std::string x;
			while(std::getline(ss, x, ',')) parts.push_back(x);
			EXPECT(static_cast<int>(parts.size()) == pl.n, "flag key [%s]: '%s'", f.c_str(), got.c_str());
			for(int s = 0; s < pl.n && s < static_cast<int>(parts.size()); ++s) {
				const bool has = team_of(pl, s) == team_of(pl, 2);
				EXPECT(has ? parts[s] == "1:77" : parts[s].compare(0, 2, "0:") == 0, "flag of seat 2 read at seat %d [%s]: '%s'", s, f.c_str(), parts[s].c_str());
			}
		}
		// read inside a scope: the Lua value is the team (Tag) or the seat (FFA); the reset takes the flag of the team
		Cfg c;
		auto l = lines(h, c, "Debug.Message('CHK fscope '..Duel.GetFlagEffect(0," + k + "))");
		EXPECT(tail(l, "fscope") == (pl.tag ? "1" : "0"), "flag read in a scope [%s]: '%s'", f.c_str(), tail(l, "fscope").c_str());
		sd::on_line = [&](const std::string& t) { o.push_back(t); };
		o.clear();
		sd::lua(d, "Duel.ResetFlagEffect(" + std::string(pl.tag ? "0" : "2") + "," + k + ") Debug.Message('CHK freset '..Duel.GetFlagEffect(2," + k + ")..' '..Duel.GetFlagEffect(0," + k + "))");
		sd::on_line = nullptr;
		EXPECT(tail(o, "freset") == "0 0", "flag reset [%s]: '%s', want '0 0'", f.c_str(), tail(o, "freset").c_str());
	}
	cap.end();
	OCG_DestroyDuel(d);
	std::printf("ok   part H %s: MPNthDuelist, MPSeat, MPSeatOf, MPBindSeat, restore, flag key\n", f.c_str());
}

#ifdef YGO_N_TRAP
// the trap build aborts when a call ends normally with a rebind open (a child process; the abort is the result)
static void part_trap() {
	Plan pl = ffa3();
	pl.mon[0] = 1;   // the filter must run at least once
	const pid_t pid = fork();
	if(pid == 0) {
		std::freopen("/dev/null", "w", stderr);
		std::freopen("/dev/null", "w", stdout);
		OCG_Duel d = build(pl);
		Hand h(d);
		h.push(Cfg{});
		sd::lua(d, "Duel.IsExistingMatchingCard(function(c) Duel.MPNthDuelist(2) return false end,0,LOCATION_MZONE,0,1,nil)");
		_exit(0);
	}
	int status = 0;
	waitpid(pid, &status, 0);
	EXPECT(WIFSIGNALED(status) && WTERMSIG(status) == SIGABRT, "trap: a call that ends with a rebind open must abort the trap build (status %d)", status);
	std::printf("ok   trap build aborts on a rebind left open\n");
}
#endif

// ---------------------------------------------------------------------------------------------- Part F: flows
static const char* kScript = R"LUA(
local s,id=GetID()
local V="@V@"
local function msg(...)
	local t={}
	for i,v in ipairs({...}) do t[i]=tostring(v) end
	Debug.Message("CHK "..table.concat(t," "))
end
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetTarget(s.tg)
	e1:SetOperation(s.op)
	c:RegisterEffect(e1)
	if V=="global" then
		local ge=Effect.GlobalEffect()
		ge:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
		ge:SetCode(EVENT_CHAINING)
		ge:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) msg("ge",tp,ep,rp) end)
		Duel.RegisterEffect(ge,0)
	end
	if V=="plain" then
		local pe=Effect.CreateEffect(c)
		pe:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
		pe:SetCode(EVENT_CHAINING)
		pe:SetRange(LOCATION_HAND+LOCATION_SZONE)
		pe:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) msg("ge",tp,ep,rp) end)
		c:RegisterEffect(pe)
	end
end
function s.tg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
end
function s.op(e,tp,eg,ep,ev,re,r,rp)
	if V=="nth" or V=="coerr" then
		local a0=Duel.MPSeat(0)
		local ok,s1=Duel.MPNthDuelist(2)
		local a1=Duel.MPSeat(0)
		Duel.SelectYesNo(0,0)
		if V=="coerr" then error("boom") end
		local a2=Duel.MPSeat(0)
		local _,k=Duel.MPNthDuelist(1)
		Duel.MPNthDuelist(0)
		local a3=Duel.MPSeat(0)
		msg("co",a0,s1,a1,a2,k,a3)
	elseif V=="bind" then
		Duel.MPBindSeat(@S@)
		Duel.SelectYesNo(0,0)
		msg("bd",Duel.GetFieldGroupCount(tp,0,LOCATION_HAND))
	end
end
)LUA";
static const char* kQuickScript = R"LUA(
local s,id=GetID()
function s.initial_effect(c)
	local e=Effect.CreateEffect(c)
	e:SetType(EFFECT_TYPE_QUICK_O)
	e:SetCode(EVENT_FREE_CHAIN)
	e:SetRange(LOCATION_MZONE)
	e:SetOperation(function() Debug.Message("CHK quick") end)
	c:RegisterEffect(e)
end
)LUA";

struct Result {
	std::vector<std::string> lines;
	std::vector<int> yn_seats;
	std::vector<int> chain_seats;
	bool done = false;
	bool map_empty = false, scopes_empty = false;
	size_t mid_saved = 0;
	int hand[4] = { 0, 0, 0, 0 };
	int stray = 0;
};
// responder: the seat that answers the chain prompt with its effect (-1 none); stop_at_prompt: leave at the first yes/no prompt
static Result play(const Plan& pl, const std::string& variant, int responder = -1, int bind_seat = 1, bool stop_at_prompt = false) {
	std::string text = kScript;
	text.replace(text.find("@V@"), 3, variant);
	text.replace(text.find("@S@"), 3, std::to_string(bind_seat));
	sd::scripts[kSpell] = text;
	sd::scripts[kQuick] = kQuickScript;
	sd::types[kSpell] = TYPE_SPELL;
	sd::types[kQuick] = TYPE_MONSTER | TYPE_EFFECT;
	sd::stray_logs = 0;
	Result r;
	Cap cap;
	cap.begin();
	OCG_Duel d = build(pl);
	sd::add(d, 0, kSpell, LOCATION_HAND);
	if(responder >= 0) sd::add(d, static_cast<uint8_t>(responder), kQuick, LOCATION_MZONE, POS_FACEUP_ATTACK, 6);
	sd::on_line = [&](const std::string& t) { r.lines.push_back(t); };
	OCG_StartDuel(d);
	std::vector<sd::Msg> msgs;
	const sd::Msg* pm = nullptr;
	bool activated = false, responded = false;
	auto* I = static_cast<duel*>(d)->lua;
	for(int steps = 0; steps < 800 && !r.done; ++steps) {
		const int status = sd::step(d, msgs, pm);
		if(status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		if(!pm) { r.done = true; break; }
		switch(pm->id) {
		case MSG_SELECT_IDLECMD:
			if(!activated) { sd::answer32(d, 5); activated = true; }
			else r.done = true;
			break;
		case MSG_SELECT_YESNO: case MSG_SELECT_EFFECTYN:
			r.yn_seats.push_back(pm->p[0]);
			r.mid_saved = std::max(r.mid_saved, I->mp_saved.size());
			if(stop_at_prompt) { r.done = true; break; }
			sd::answer32(d, 1);
			break;
		case MSG_SELECT_CHAIN:
			r.chain_seats.push_back(pm->p[0]);
			// the responder answers once (its quick effect can chain to itself)
			if(responder >= 0 && pm->p[0] == responder && !responded) { responded = true; sd::answer32(d, 0); }
			else sd::answer32(d, -1);
			break;
		case MSG_SELECT_PLACE: {
			uint32_t flag = 0;
			std::memcpy(&flag, pm->p + 2, 4);
			uint8_t loc = LOCATION_SZONE, seq = 0;
			for(int i = 8; i < 13; ++i)
				if(!(flag & (1u << i))) { seq = static_cast<uint8_t>(i - 8); break; }
			const uint8_t resp[3] = { pm->p[0], loc, seq };
			OCG_DuelSetResponse(d, resp, sizeof(resp));
			break;
		}
		default:
			std::printf("FAIL: unexpected prompt %u (seat %d), variant %s\n", pm->id, pm->p[0], variant.c_str());
			++failures;
			r.done = true;
		}
	}
	for(int p = 0; p < pl.n; ++p) r.hand[p] = static_cast<int>(sd::F(d).player[p].list_hand.size());
	r.map_empty = I->mp_saved.empty();
	r.scopes_empty = I->scopes.empty();
	sd::on_line = nullptr;
	OCG_DestroyDuel(d);
	cap.end();
	r.stray = sd::stray_logs;
	return r;
}
static std::vector<std::vector<std::string>> find_lines(const Result& r, const std::string& key) {
	std::vector<std::vector<std::string>> out;
	for(const auto& l : r.lines) {
		std::stringstream ss(l);
		std::string w;
		std::vector<std::string> v;
		while(ss >> w) v.push_back(w);
		if(v.size() >= 2 && v[1] == key) { v.erase(v.begin(), v.begin() + 2); out.push_back(v); }
	}
	return out;
}

static void flow_global() {
	for(Plan pl : { ffa3(), ffa4(), tag4() }) {
		for(int T = 2; T < pl.n; ++T) {
			for(const char* v : { "global", "plain" }) {
				const Result r = play(pl, v, T);
				if(std::getenv("F7S_DEBUG")) { std::printf("-- %s %s T=%d chain %s yn %s\n", label(pl).c_str(), v, T, ints(r.chain_seats).c_str(), ints(r.yn_seats).c_str()); for(const auto& l : r.lines) std::printf("   %s\n", l.c_str()); }
				const auto ge = find_lines(r, "ge");
				std::vector<int> rps;
				for(const auto& l : ge) if(l.size() == 3) rps.push_back(std::stoi(l[2]));
				const bool global = std::string(v) == "global";
				// global: the real seat of the event. plain: the fold of the seat T for the seat 0 (FFA 1, Tag the team)
				const int want = global ? T : (pl.tag ? T % 2 : 1);
				const bool has = std::find(rps.begin(), rps.end(), want) != rps.end();
				const bool has_real = std::find(rps.begin(), rps.end(), T) != rps.end();
				EXPECT(r.done && has, "%s effect, responder seat %d [%s]: rp values '%s', want %d among them", v, T, label(pl).c_str(), ints(rps).c_str(), want);
				if(!global) EXPECT(!has_real || want == T, "plain effect [%s]: saw the real seat %d (fold missing)", label(pl).c_str(), T);
				EXPECT(r.stray == 0 && r.scopes_empty, "%s effect, seat %d [%s]: stray %d scopes_empty %d", v, T, label(pl).c_str(), r.stray, r.scopes_empty);
			}
		}
	}
	std::printf("ok   global effect: real rp / ep at the seats 2 and 3; a plain effect keeps the fold\n");
}

static void flow_prompt() {
	for(Plan pl : { ffa3(), ffa4(), tag4() }) {
		const std::string f = label(pl);
		for(int s = 0; s < pl.n; ++s) { pl.mon[s] = 0; pl.hand[s] = 2 + s; }
		{
			const Result r = play(pl, "nth");
			const auto co = find_lines(r, "co");
			const std::string got = co.empty() ? "<none>" : join(co[0]);
			const std::string want = pl.tag ? "0 1 0 0 0 0" : "0 1 1 1 0 0";
			EXPECT(r.done && got == want, "prompt in fn, rebind [%s]: '%s', want '%s'", f.c_str(), got.c_str(), want.c_str());
			if(!pl.tag) EXPECT(r.yn_seats.size() == 1 && r.yn_seats[0] == 1, "prompt in fn, rebind [%s]: the prompt went to seat %s, want 1", f.c_str(), ints(r.yn_seats).c_str());
			EXPECT(r.map_empty && r.scopes_empty && r.stray == 0, "prompt in fn, rebind [%s]: map_empty %d scopes_empty %d stray %d", f.c_str(), r.map_empty, r.scopes_empty, r.stray);
			EXPECT(r.mid_saved == 1, "prompt in fn, rebind [%s]: %zu saved state(s) during the prompt, want 1", f.c_str(), r.mid_saved);
		}
		{
			// the duel is destroyed at the prompt: nothing leaks (the sanitizer is the judge) and the state was saved
			const Result r = play(pl, "nth", -1, 1, true);
			EXPECT(r.mid_saved == 1, "stop at the prompt [%s]: %zu saved state(s), want 1", f.c_str(), r.mid_saved);
		}
		{
			const Result r = play(pl, "coerr");
			EXPECT(r.done && r.map_empty && r.scopes_empty && r.stray >= 1, "Lua error after a prompt, rebind open [%s]: done %d map_empty %d scopes_empty %d stray %d", f.c_str(), r.done, r.map_empty, r.scopes_empty, r.stray);
		}
		{
			const int S = opponents(pl)[pl.tag ? 0 : 1];
			const Result r = play(pl, "bind", -1, S);
			const auto bd = find_lines(r, "bd");
			const std::string want = std::to_string(r.hand[S]);
			EXPECT(r.done && bd.size() == 1 && bd[0].size() == 1 && bd[0][0] == want, "prompt in fn, MPBindSeat(%d) [%s]: '%s', want %s", S, f.c_str(), bd.empty() ? "<none>" : join(bd[0]).c_str(), want.c_str());
			EXPECT(r.map_empty && r.scopes_empty && r.stray == 0, "prompt in fn, MPBindSeat [%s]: map_empty %d scopes_empty %d stray %d", f.c_str(), r.map_empty, r.scopes_empty, r.stray);
		}
	}
	std::printf("ok   prompt in the function: the rebind and the seat bind survive, the saved state is erased\n");
}

// ---------------------------------------------------------------------------------------------- n == 2
static void part_n2() {
	OCG_Duel d = sd::create("");
	std::vector<std::string> l;
	sd::on_line = [&](const std::string& t) { l.push_back(t); };
	sd::scripts[kMon] = "local s,id=GetID()\nfunction s.initial_effect(c) end\n";
	sd::types[kMon] = TYPE_MONSTER | TYPE_NORMAL;
	sd::add(d, 1, kMon, LOCATION_MZONE, POS_FACEUP_ATTACK, 0);
	const std::string k = std::to_string(kFlag);
	sd::lua(d, "local c=Duel.GetFieldGroup(1,LOCATION_MZONE,0):GetFirst() Duel.RegisterFlagEffect(1," + k + ",0,0,1) Debug.Message('CHK n2 '..tostring(Duel.MPNthDuelist(1))..' '..tostring(Duel.MPNthDuelist(0))..' '..Duel.MPSeat(0)..' '..Duel.MPSeat(1)..' '..Duel.MPSeat(5)..' '..Duel.MPSeatOf(c)..' '..tostring(Duel.MPBindSeat(1))..' '..Duel.GetFlagEffect(0," + k + ")..Duel.GetFlagEffect(1," + k + "))");
	sd::on_line = nullptr;
	const std::string want = "false false 0 1 5 1 true 01";
	EXPECT(tail(l, "n2") == want, "n == 2: '%s', want '%s'", tail(l, "n2").c_str(), want.c_str());
	EXPECT(sd::stray_logs == 0, "n == 2: stray log lines");
	OCG_DestroyDuel(d);
	std::printf("ok   n == 2: the new functions answer with the stock value, a flag keeps the seat\n");
}

int main() {
	sd::scripts[kFiller] = "local s,id=GetID()\nfunction s.initial_effect(c) end\n";
	Plan units[3] = { ffa3(), ffa4(), tag4() };
	for(auto& p : units)
		for(int s = 0; s < p.n; ++s) { p.mon[s] = s + 1; p.hand[s] = 2 + s; }
	for(const auto& p : units) part_h(p);
#ifdef YGO_N_TRAP
	part_trap();
#endif
	part_n2();
	flow_global();
	flow_prompt();
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
