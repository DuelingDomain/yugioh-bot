// F7 part P1 native check: the one-opponent window (Duel.MP* API) at n = 3, n = 4 (free-for-all) and Tag.
// Synthetic scripts only (codes 91001..91003). Every card script is made here. Run it with the core library built with
// -DYGO_N_TRAP (the NFOLD records and the debug errors are part of what it checks); the expectations that differ in a
// release core are marked (#ifdef YGO_N_TRAP).
//
// Part A, ranges (a scope is pushed by hand, no duel flow): field::build_range_list, get_overlay_count and
//   get_field_counter under: no window (stock), a ONE window, a SEAT window, an exclusive (summon procedure) scope, with a
//   dead seat, a seat of the own team, and no seat. Tag: the ONE window is ignored, a SEAT window reads one duelist,
//   exclusive still reads one opposing member (T4 / W15 / W6 / W14).
// Part B, API in a scope that cannot ask (a scope is pushed by hand, Lua is run in it): MPMode, MPBound, MPOppCount,
//   MPNeedPick, MPBindOpponent (W11: Lua error in the trap build, false in release, no prompt), MPWindow, MPWindowEnd,
//   MPAssertBound (W18), a window with no seat (W14), the same-effect scope copy (review fix 2), release lists
//   (fix 5), the MPWindow argument range (fix 6), and n == 2 (no mode, no window). Part A also checks the use mask of
//   build_range_list: the core lists of field effects ignore a window (fix 4).
// Part C, real flows (a Spell of seat 0 is activated, the harness answers the prompts):
//   window    the window survives a prompt (W4n), pick asked at activation, Tag ignores the ONE window (T2)
//   anyloop   compare with the any-loop: one passing opponent is bound without a question, two ask the activator, the SUM
//             passing does not offer the card, own > one opponent (W3), Tag pure compare (T1)
//   seat      SEAT windows: GetLP, hands, field, overlays, counters, Draw(1-tp), one run per duelist (W17)
//   place     SelectDisableField in SEAT windows: the place prompt names the window seat
//   raigeki   no window: every opponent is hit (unchanged)
//   assertu / assertb   MPAssertBound without and with a bound opponent (W18)
//   w16       the window is not copied into the condition of another card, and an error there does not close it (W16, W13)
//   err, errt a Lua error inside a window on the pinned probe path, cost and target (W13)
//   coerr     a Lua error in a coroutine after a prompt: the saved window is erased (W13)
//   tgwin, tgbind, conassert   review fix 1: a ONE window (or MPBindOpponent, MPAssertBound) in the target or condition
//             check of an activation: the first run of the probe has nothing bound and must not hide the card; the
//             run per opponent decides who is legal (silent bind, a pick, or not offered)
//   nested    review fix 2, flow: a filter with an effect argument inside a ONE window reads the bound opponent (no new
//             scope there; the scope copy itself is in part B: a condition of the same effect gets window and opponent)
//   emptywin  review fix 3: GetLP, Draw and a hand count with 1-tp inside a window with no seat give nothing: no
//             widening, no pick prompt, no card drawn
//   lazybind  review fix 3: MPBindOpponent inside a SEAT window (nothing bound) still asks the pick and binds
#include "scripted-duel.h"
#include <unistd.h>
#include "card.h"
#include "effect.h"
#include "interpreter.h"

static const uint32_t kFiller = 5000;
static const uint32_t kSpell = 91001;
static const uint32_t kMon = 91003;
static const int kStartHand = 5;   // OCG_StartDuel draws the opening hand of every seat (team start hand 5)

// ---------------------------------------------------------------------------------------------- stderr capture
struct Cap {
	int fd = -1, saved = -1;
	std::string path;
	void begin() {
		path = check_tmp_template("f7-window-stderr");
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
	std::string setup;     // Debug.SetupDuelists(...)
	int n = 3;
	bool tag = false;
	int mon[4] = { 0, 0, 0, 0 };       // monsters per seat
	int hand[4] = { 2, 2, 2, 2 };      // hand cards per seat (seat 0 has the Spell besides)
	int lp[4] = { 8000, 8000, 8000, 8000 };
	int ov[4] = { 0, 0, 0, 0 };        // overlay materials on the first monster of the seat
	int ctr[4] = { 0, 0, 0, 0 };       // counters (type 1) on the first monster of the seat
};
static Plan ffa3() { Plan p; p.setup = "Debug.SetupDuelists(3,0,1,2)"; p.n = 3; return p; }
static Plan ffa4() { Plan p; p.setup = "Debug.SetupDuelists(4,0,1,2,3)"; p.n = 4; return p; }
static Plan tag4() { Plan p; p.setup = "Debug.SetupDuelists(4,0,1,0,1)"; p.n = 4; p.tag = true; return p; }

static OCG_Duel build(const Plan& pl) {
	sd::scripts[kMon] = "local s,id=GetID()\nfunction s.initial_effect(c) end\n";
	sd::types[kMon] = TYPE_MONSTER | TYPE_NORMAL;
	sd::types[kSpell] = TYPE_SPELL;
	OCG_Duel d = sd::create(pl.setup);
	for(int p = 0; p < pl.n; ++p) {
		for(int i = 0; i < 30; ++i) sd::add(d, static_cast<uint8_t>(p), kFiller, LOCATION_DECK);
		for(int i = 0; i < pl.hand[p]; ++i) sd::add(d, static_cast<uint8_t>(p), kFiller, LOCATION_HAND);
		for(int i = 0; i < pl.mon[p]; ++i) sd::add(d, static_cast<uint8_t>(p), kMon, LOCATION_MZONE, POS_FACEUP_ATTACK, static_cast<uint32_t>(i));
	}
	return d;
}
// lp, overlays and counters are set directly on the field (after the cards exist)
static void decorate(OCG_Duel d, const Plan& pl, bool cards = true) {
	auto& f = sd::F(d);
	auto* pd = static_cast<duel*>(d);
	for(int p = 0; p < pl.n; ++p) {
		f.lp_ref(static_cast<uint8_t>(p)) = pl.lp[p];
		if(!cards) continue;
		card* host = nullptr;
		for(auto* c : f.player[p].list_mzone) if(c) { host = c; break; }
		if(!host) continue;
		for(int i = 0; i < pl.ov[p]; ++i) {
			card* m = pd->new_card(kFiller);
			m->current.controler = static_cast<uint8_t>(p);
			m->current.location = LOCATION_OVERLAY;
			m->overlay_target = host;
			host->xyz_materials.push_back(m);
		}
		if(pl.ctr[p]) host->counters[0x1] = { static_cast<uint16_t>(pl.ctr[p]), 0 };
	}
}

// ---------------------------------------------------------------------------------------------- Part C: flows
static const char* kScript = R"LUA(
local s,id=GetID()
local V="@V@"
cost_runs=0
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetCondition(s.con)
	e1:SetCost(s.cost)
	e1:SetTarget(s.tg)
	e1:SetOperation(s.op)
	c:RegisterEffect(e1)
end
local function msg(...)
	local t={}
	for i,v in ipairs({...}) do t[i]=tostring(v) end
	Debug.Message("CHK "..table.concat(t," "))
end
local function cnt(tp) return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end
local function cmp_gt(tp,own) return cnt(tp)>own end
local function cmp_lt(tp,own) return own>cnt(tp) end
function s.con(e,tp,eg,ep,ev,re,r,rp)
	if V=="window" or V=="err" or V=="errt" or V=="w16" or V=="assertb" or V=="coerr" or V=="nested" then
		Duel.MPNeedPick()
		return true
	end
	if V=="conassert" then
		if not Duel.MPAssertBound() then return false end
		Duel.MPWindow(0) local r=cnt(tp)>=2 Duel.MPWindowEnd() return r
	end
	if V=="anyloop" or V=="anyloop_lt" then
		local own=Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)
		local f=(V=="anyloop") and cmp_gt or cmp_lt
		local mode=Duel.MPMode()
		if mode~=1 then return f(tp,own) end
		if Duel.MPBound() then
			Duel.MPWindow(0) local r=f(tp,own) Duel.MPWindowEnd() return r
		end
		Duel.MPNeedPick()
		for i=1,Duel.MPOppCount() do
			Duel.MPWindow(i) local r=f(tp,own) Duel.MPWindowEnd()
			if r then return true end
		end
		return false
	end
	return true
end
function s.cost(e,tp,eg,ep,ev,re,r,rp,chk)
	if V=="err" and chk==0 then
		cost_runs=cost_runs+1
		msg("cost",cost_runs,cnt(tp))
		if cost_runs==2 then Duel.MPWindow(1) error("boom") end
	end
	return true
end
function s.tg(e,tp,eg,ep,ev,re,r,rp,chk)
	if V=="tgwin" then
		if chk==0 then
			Duel.MPWindow(0)
			local r=Duel.IsExistingMatchingCard(function(c) return true end,tp,0,LOCATION_MZONE,1,nil)
			Duel.MPWindowEnd()
			return r
		end
		Duel.MPBindOpponent(true)
		return true
	end
	if V=="tgbind" then
		if chk==0 then
			if not Duel.MPBindOpponent(true) then return false end
			Duel.MPWindow(0) local r=cnt(tp)>=2 Duel.MPWindowEnd() return r
		end
		return true
	end
	if V=="errt" and chk==0 then
		cost_runs=cost_runs+1
		msg("tg",cost_runs,cnt(tp))
		if cost_runs==2 then Duel.MPWindow(1) error("boom") end
	end
	return true
end
function s.op(e,tp,eg,ep,ev,re,r,rp)
	msg("opstart")
	if V=="window" then
		Duel.MPBindOpponent(true)
		Duel.MPWindow(0)
		local a=cnt(tp)
		Duel.SelectYesNo(tp,0)
		local b=cnt(tp)
		Duel.MPWindowEnd()
		local c=cnt(tp)
		msg("w",a,b,c,tostring(Duel.MPBound()))
	elseif V=="nested" then
		Duel.MPBindOpponent(true)
		Duel.MPWindow(0)
		Duel.IsExistingMatchingCard(function(c,e2) msg("nest",cnt(tp)) return true end,tp,0,LOCATION_MZONE,1,nil,e)
		Duel.MPWindowEnd()
		msg("nestdone")
	elseif V=="emptywin" then
		Duel.MPWindow(9)
		local lp=Duel.GetLP(1-tp)
		Duel.Draw(1-tp,1,REASON_EFFECT)
		local n=Duel.GetFieldGroupCount(1-tp,LOCATION_HAND,0)
		Duel.MPWindowEnd()
		msg("emptywin",tostring(lp),n)
	elseif V=="lazybind" then
		Duel.MPWindow(1)
		local ok=Duel.MPBindOpponent(true)
		Duel.MPWindowEnd()
		msg("lb",tostring(ok),tostring(Duel.MPBound()))
	elseif V=="anyloop" or V=="anyloop_lt" or V=="tgwin" or V=="tgbind" or V=="conassert" then
		if Duel.MPMode()==1 then
			local ok=Duel.MPAssertBound()
			Duel.MPWindow(0)
			local a=cnt(tp)
			Duel.MPWindowEnd()
			msg("op",tostring(ok),a)
		else
			msg("op","tag",cnt(tp))
		end
	elseif V=="seat" then
		for i=1,Duel.MPOppCount() do
			Duel.MPWindow(i)
			msg("seat",i,Duel.GetLP(1-tp),cnt(tp),Duel.GetFieldGroupCount(tp,0,LOCATION_HAND),Duel.GetOverlayCount(tp,0,1),Duel.GetCounter(tp,0,1,0x1))
			Duel.Draw(1-tp,1,REASON_EFFECT)
			Duel.MPWindowEnd()
		end
		msg("done")
	elseif V=="place" then
		for i=1,Duel.MPOppCount() do
			Duel.MPWindow(i)
			Duel.SelectDisableField(tp,1,0,LOCATION_MZONE,0)
			Duel.MPWindowEnd()
		end
		msg("done")
	elseif V=="raigeki" then
		local g=Duel.GetFieldGroup(tp,0,LOCATION_MZONE)
		msg("rg",#g)
		Duel.Destroy(g,REASON_EFFECT)
	elseif V=="assertu" or V=="assertb" then
		local ok=pcall(Duel.MPAssertBound)
		msg("assert",tostring(ok),tostring(Duel.MPBound()))
	elseif V=="w16" then
		Duel.MPBindOpponent(true)
		Duel.MPWindow(0)
		local e1=Effect.CreateEffect(e:GetHandler())
		e1:SetType(EFFECT_TYPE_FIELD)
		e1:SetCode(EFFECT_CANNOT_REMOVE)
		e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
		e1:SetTargetRange(1,0)
		e1:SetCondition(function(e2) msg("w16cond",Duel.GetFieldGroupCount(e2:GetHandlerPlayer(),0,LOCATION_MZONE)) return false end)
		Duel.RegisterEffect(e1,tp)
		local e3=Effect.CreateEffect(e:GetHandler())
		e3:SetType(EFFECT_TYPE_FIELD)
		e3:SetCode(EFFECT_CANNOT_REMOVE)
		e3:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
		e3:SetTargetRange(1,0)
		e3:SetCondition(function(e2) Duel.MPWindow(1) error("boom") end)
		Duel.RegisterEffect(e3,tp)
		local a=cnt(tp)
		Duel.IsPlayerCanRemove(tp)
		local b=cnt(tp)
		Duel.MPWindowEnd()
		msg("w16",a,b)
	elseif V=="coerr" then
		Duel.MPWindow(0)
		local a=cnt(tp)
		Duel.SelectYesNo(tp,0)
		local b=cnt(tp)
		msg("co",a,b)
		error("boom")
	end
end
)LUA";

struct Result {
	bool done = false, offered = true;
	int opt_prompts = 0, opt_before_op = 0;
	std::vector<int> opt_seats;
	std::vector<int> hints;
	std::vector<std::string> lines, nfold;
	int mon[4] = { 0, 0, 0, 0 }, hand[4] = { 0, 0, 0, 0 };
	bool map_empty = false, scopes_empty = false;
	int stray = 0;
};

static std::vector<std::string> words(const std::string& s) {
	std::vector<std::string> w;
	std::istringstream in(s);
	for(std::string x; in >> x;) w.push_back(x);
	return w;
}
// the first CHK line that starts with `key` as a vector of words (after "CHK"), empty when there is none
static std::vector<std::string> find_line(const Result& r, const std::string& key) {
	for(const auto& l : r.lines) {
		auto w = words(l);
		if(w.size() >= 2 && w[1] == key) { w.erase(w.begin()); return w; }
	}
	return {};
}
static std::vector<std::vector<std::string>> find_lines(const Result& r, const std::string& key) {
	std::vector<std::vector<std::string>> out;
	for(const auto& l : r.lines) {
		auto w = words(l);
		if(w.size() >= 2 && w[1] == key) { w.erase(w.begin()); out.push_back(w); }
	}
	return out;
}

static Result play(const Plan& pl, const std::string& variant, int pick = 1) {
	std::string text = kScript;
	text.replace(text.find("@V@"), 3, variant);
	sd::scripts[kSpell] = text;
	sd::stray_logs = 0;
	Result r;
	Cap cap;
	cap.begin();
	OCG_Duel d = build(pl);
	sd::add(d, 0, kSpell, LOCATION_HAND);
	decorate(d, pl);
	bool op_started = false;
	sd::on_line = [&](const std::string& t) {
		r.lines.push_back(t);
		if(t == "CHK opstart") op_started = true;
	};
	OCG_StartDuel(d);
	decorate(d, pl, false);  // the LP is set again after StartDuel
	std::vector<sd::Msg> msgs;
	const sd::Msg* pm = nullptr;
	bool activated = false;
	for(int steps = 0; steps < 800 && !r.done; ++steps) {
		const int status = sd::step(d, msgs, pm);
		for(const auto& x : msgs) if(x.id == MSG_RETRY) r.offered = false;
		if(status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		if(!pm) {
			if(!r.offered) { r.done = true; break; }   // the refused activation: the core waits for the next answer without a new prompt
			std::printf("FAIL: awaiting without a prompt\n"); ++failures; break;
		}
		switch(pm->id) {
		case MSG_SELECT_IDLECMD:
			if(!activated) { sd::answer32(d, 5); activated = true; }
			else r.done = true;
			break;
		case MSG_SELECT_OPTION: {
			++r.opt_prompts;
			if(!op_started) ++r.opt_before_op;
			r.opt_seats.push_back(pm->p[0]);
			const int count = pm->p[1];
			sd::answer32(d, pick < count ? pick : 0);
			break;
		}
		case MSG_SELECT_YESNO: case MSG_SELECT_EFFECTYN: sd::answer32(d, 1); break;
		case MSG_SELECT_CHAIN: sd::answer32(d, -1); break;
		case MSG_SELECT_CARD: {
			uint32_t min = 0;
			std::memcpy(&min, pm->p + 2, 4);
			std::vector<uint32_t> rr{ 0, min };
			for(uint32_t i = 0; i < min; ++i) rr.push_back(i);
			OCG_DuelSetResponse(d, rr.data(), static_cast<uint32_t>(rr.size() * 4));
			break;
		}
		case MSG_SELECT_PLACE: case MSG_SELECT_DISFIELD: {
			uint32_t flag = 0;
			std::memcpy(&flag, pm->p + 2, 4);
			int seat = pm->p[0];
			int hint = -1;
			if(msgs.size() >= 2) {
				const sd::Msg& h = msgs[msgs.size() - 2];
				if(h.id == MSG_HINT && h.len >= 10 && h.p[0] == HINT_PLACE_SEAT) {
					uint64_t t = 0;
					std::memcpy(&t, h.p + 2, 8);
					hint = static_cast<int>(t);
					seat = hint;
				}
			}
			if(hint >= 0) r.hints.push_back(hint);
			const bool own_prompt = hint < 0 || seat == pm->p[0];
			const int base = own_prompt ? 0 : 16;
			uint8_t loc = LOCATION_MZONE, seq = 0;
			for(int i = 0; i < 13; ++i) {
				if(i == 7) continue;
				if(!(flag & (1u << (base + i)))) {
					loc = i < 8 ? LOCATION_MZONE : LOCATION_SZONE;
					seq = static_cast<uint8_t>(i < 8 ? i : i - 8);
					break;
				}
			}
			const uint8_t resp[3] = { static_cast<uint8_t>(seat), loc, seq };
			OCG_DuelSetResponse(d, resp, sizeof(resp));
			break;
		}
		default:
			std::printf("FAIL: unexpected prompt %u (seat %d), variant %s\n", pm->id, pm->p[0], variant.c_str());
			++failures;
			r.done = true;
		}
	}
	for(int p = 0; p < pl.n; ++p) {
		r.mon[p] = sd::mzone_count(d, p);
		r.hand[p] = static_cast<int>(sd::F(d).player[p].list_hand.size());
	}
	auto* I = static_cast<duel*>(d)->lua;
	r.map_empty = I->mp_saved.empty();
	r.scopes_empty = I->scopes.empty();
	sd::on_line = nullptr;
	OCG_DestroyDuel(d);
	r.nfold = cap.end();
	r.stray = sd::stray_logs;
	return r;
}

static std::string join(const std::vector<std::string>& v) {
	std::string s;
	for(const auto& x : v) s += (s.empty() ? "" : " ") + x;
	return s;
}
static std::string ints(const std::vector<int>& v) {
	std::string s;
	for(int x : v) s += (s.empty() ? "" : ",") + std::to_string(x);
	return s;
}
static std::string label(const Plan& pl) { return pl.tag ? "tag" : (pl.n == 3 ? "ffa3" : "ffa4"); }

static void flow_window() {
	for(Plan pl : { ffa3(), ffa4(), tag4() }) {
		// seat 0 = the activator. FFA: opponents are the seats 1.. ; Tag: seat 2 is the partner (3 monsters), opponents 1 and 3.
		if(pl.tag) { pl.mon[1] = 1; pl.mon[2] = 3; pl.mon[3] = 2; }
		else if(pl.n == 3) { pl.mon[1] = 1; pl.mon[2] = 3; }
		else { pl.mon[1] = 1; pl.mon[2] = 3; pl.mon[3] = 2; }
		const Result r = play(pl, "window");
		const auto w = find_line(r, "w");
		EXPECT(r.done && w.size() == 5, "window %s: scenario did not finish (line: '%s')", label(pl).c_str(), join(w).c_str());
		if(w.size() < 5) continue;
		// the pick (option 1) is the second opponent: seat 2 in FFA, seat 3 in Tag
		const int a = std::stoi(w[1]), b = std::stoi(w[2]), c = std::stoi(w[3]);
		int wa, wc;
		if(pl.tag) { wa = 3; wc = 3; }              // the ONE window is ignored in Tag: the joined opposing field (1 + 2)
		else { wa = 3; wc = pl.n == 3 ? 4 : 6; }    // seat 2 only inside, every opponent outside
		EXPECT(a == wa, "window %s: read before the prompt = %d, want %d", label(pl).c_str(), a, wa);
		EXPECT(b == wa, "window %s: read AFTER the prompt = %d, want %d (the window must survive the prompt)", label(pl).c_str(), b, wa);
		EXPECT(c == wc, "window %s: read after MPWindowEnd = %d, want %d (every opponent again)", label(pl).c_str(), c, wc);
		EXPECT(w[4] == "true", "window %s: MPBound() = %s", label(pl).c_str(), w[4].c_str());
		EXPECT(r.opt_prompts == 1 && r.opt_before_op == 1, "window %s: %d pick prompt(s), %d before the operation, want 1 and 1", label(pl).c_str(), r.opt_prompts, r.opt_before_op);
		EXPECT(r.map_empty && r.scopes_empty, "window %s: window map or scope stack not empty at the end", label(pl).c_str());
		EXPECT(kind_count(r.nfold, 'c') == 0 && kind_count(r.nfold, 'W') == 0 && kind_count(r.nfold, 'U') == 0 && kind_count(r.nfold, 'a') == 0,
			   "window %s: unexpected NFOLD records: %s", label(pl).c_str(), join(r.nfold).c_str());
		EXPECT(r.stray == 0, "window %s: %d stray log line(s)", label(pl).c_str(), r.stray);
		std::printf("ok   window %s: inside %d/%d, outside %d, one pick at activation\n", label(pl).c_str(), a, b, c);
	}
}

static void flow_anyloop() {
	struct Case { const char* name; Plan pl; const char* v; std::vector<int> mon; bool offered; int prompts; const char* op; };
	std::vector<Case> cases;
	cases.push_back({ "one opponent passes (compare >)", ffa3(), "anyloop", { 2, 1, 3 }, true, 0, "op true 3" });
	cases.push_back({ "both pass, the activator is asked", ffa3(), "anyloop", { 2, 4, 3 }, true, 1, "op true 3" });
	cases.push_back({ "the SUM passes, no single opponent does", ffa3(), "anyloop", { 1, 1, 1 }, false, 0, "" });
	cases.push_back({ "own > one opponent only (W3)", ffa3(), "anyloop_lt", { 2, 1, 5 }, true, 0, "op true 1" });
	cases.push_back({ "FFA4 two pass, pick 1 = seat 3", ffa4(), "anyloop", { 2, 3, 1, 4 }, true, 1, "op true 4" });
	cases.push_back({ "Tag pure compare, joined field (T1)", tag4(), "anyloop", { 1, 1, 0, 2 }, true, 0, "op tag 3" });
	cases.push_back({ "Tag pure compare fails", tag4(), "anyloop", { 3, 1, 0, 1 }, false, 0, "" });
	for(auto& c : cases) {
		for(int i = 0; i < 4; ++i) c.pl.mon[i] = i < static_cast<int>(c.mon.size()) ? c.mon[i] : 0;
		const Result r = play(c.pl, c.v);
		const auto l = find_line(r, "op");
		EXPECT(r.offered == c.offered, "anyloop %s [%s]: offered=%d, want %d", c.name, label(c.pl).c_str(), r.offered, c.offered);
		EXPECT(r.opt_prompts == c.prompts, "anyloop %s [%s]: %d pick prompt(s), want %d", c.name, label(c.pl).c_str(), r.opt_prompts, c.prompts);
		if(c.prompts) EXPECT(r.opt_before_op == c.prompts, "anyloop %s [%s]: the pick came during the operation", c.name, label(c.pl).c_str());
		if(c.offered) EXPECT(!l.empty() && join(l) == c.op, "anyloop %s [%s]: op line '%s', want '%s'", c.name, label(c.pl).c_str(), join(l).c_str(), c.op);
		EXPECT(kind_count(r.nfold, 'c') == 0 && kind_count(r.nfold, 'U') == 0 && kind_count(r.nfold, 'W') == 0, "anyloop %s [%s]: NFOLD %s", c.name, label(c.pl).c_str(), join(r.nfold).c_str());
		EXPECT(r.stray == 0 && r.map_empty && r.scopes_empty, "anyloop %s [%s]: stray %d map %d scopes %d", c.name, label(c.pl).c_str(), r.stray, r.map_empty, r.scopes_empty);
		std::printf("ok   anyloop %s [%s]: offered %d, prompts %d, op '%s'\n", c.name, label(c.pl).c_str(), r.offered, r.opt_prompts, join(l).c_str());
	}
}

static void flow_seat() {
	for(Plan pl : { ffa3(), ffa4(), tag4() }) {
		// seat s: monsters, hand, lp, overlays, counters are all different, so a read of the wrong seat shows
		const int mon[4] = { 0, 1, 3, 2 }, hand[4] = { 2, 3, 4, 5 }, lp[4] = { 8000, 6000, 4000, 3000 }, ov[4] = { 0, 1, 2, 3 }, ctr[4] = { 0, 1, 3, 4 };
		for(int i = 0; i < pl.n; ++i) { pl.mon[i] = mon[i]; pl.hand[i] = hand[i]; pl.lp[i] = lp[i]; pl.ov[i] = ov[i]; pl.ctr[i] = ctr[i]; }
		if(pl.tag) pl.lp[2] = pl.lp[0], pl.lp[3] = pl.lp[1];   // one LP per team
		if(pl.tag) pl.mon[2] = 3, pl.ov[2] = 5, pl.ctr[2] = 9;  // the partner has the biggest numbers: it must never be read
		const Result r = play(pl, "seat");
		std::vector<int> opp;  // the opponents in turn order after seat 0
		for(int q = 1; q < pl.n; ++q) if(!pl.tag || (q % 2) == 1) opp.push_back(q);
		const auto rows = find_lines(r, "seat");
		EXPECT(r.done && rows.size() == opp.size() && !find_line(r, "done").empty(), "seat %s: %zu run(s), want %zu", label(pl).c_str(), rows.size(), opp.size());
		for(size_t k = 0; k < rows.size() && k < opp.size(); ++k) {
			const int q = opp[k];
			// columns: seat i, GetLP(1-tp), cnt, hand, overlays, counters
			const int wlp = pl.tag ? lp[1] : lp[q];  // team LP in Tag (seat 1 and seat 3 are one team)
			const std::vector<std::string> want = { "seat", std::to_string(k + 1), std::to_string(wlp), std::to_string(mon[q]), std::to_string(hand[q] + kStartHand), std::to_string(ov[q]), std::to_string(ctr[q]) };
			EXPECT(rows[k] == want, "seat %s: run %zu read '%s', want '%s'", label(pl).c_str(), k + 1, join(rows[k]).c_str(), join(want).c_str());
		}
		// Draw(1-tp) inside the window drew for that seat only: every opponent +1, the activator and the partner unchanged
		for(int q = 0; q < pl.n; ++q) {
			const bool is_opp = std::find(opp.begin(), opp.end(), q) != opp.end();
			const int want = hand[q] + kStartHand + (is_opp ? 1 : 0);
			EXPECT(r.hand[q] == want, "seat %s: hand of seat %d = %d, want %d", label(pl).c_str(), q, r.hand[q], want);
		}
		EXPECT(r.opt_prompts == 0, "seat %s: %d pick prompt(s) inside SEAT windows, want none", label(pl).c_str(), r.opt_prompts);
		EXPECT(kind_count(r.nfold, 'c') == 0 && kind_count(r.nfold, 'W') == 0 && kind_count(r.nfold, 'a') == 0, "seat %s: NFOLD %s", label(pl).c_str(), join(r.nfold).c_str());
		EXPECT(r.stray == 0 && r.map_empty && r.scopes_empty, "seat %s: stray %d map %d scopes %d", label(pl).c_str(), r.stray, r.map_empty, r.scopes_empty);
		std::printf("ok   seat %s: one run per opponent duelist, reads and Draw follow the window seat\n", label(pl).c_str());
	}
}

static void flow_place() {
	struct Case { Plan pl; std::vector<int> want; };
	std::vector<Case> cases = { { ffa3(), { 1, 2 } }, { ffa4(), { 1, 2, 3 } }, { tag4(), { 1, 3 } } };
	for(auto& c : cases) {
		const Result r = play(c.pl, "place");
		EXPECT(r.done && r.hints == c.want, "place %s: place prompts named seats %s, want %s", label(c.pl).c_str(), ints(r.hints).c_str(), ints(c.want).c_str());
		EXPECT(r.opt_prompts == 0, "place %s: %d pick prompt(s)", label(c.pl).c_str(), r.opt_prompts);
		std::printf("ok   place %s: prompt seats %s\n", label(c.pl).c_str(), ints(r.hints).c_str());
	}
}

static void flow_raigeki() {
	for(Plan pl : { ffa3(), ffa4(), tag4() }) {
		const int mon[4] = { 0, 1, 3, 2 };
		for(int i = 0; i < pl.n; ++i) pl.mon[i] = mon[i];
		const Result r = play(pl, "raigeki");
		const auto l = find_line(r, "rg");
		const int want_rg = pl.tag ? 3 : (pl.n == 3 ? 4 : 6);
		EXPECT(l.size() == 2 && std::stoi(l[1]) == want_rg, "raigeki %s: the group has %s card(s), want %d (every opponent)", label(pl).c_str(), l.size() == 2 ? l[1].c_str() : "?", want_rg);
		for(int q = 1; q < pl.n; ++q) {
			const bool partner = pl.tag && q == 2;
			EXPECT(r.mon[q] == (partner ? 3 : 0), "raigeki %s: seat %d has %d monster(s) at the end, want %d", label(pl).c_str(), q, r.mon[q], partner ? 3 : 0);
		}
		EXPECT(r.opt_prompts == 0 && r.stray == 0, "raigeki %s: prompts %d stray %d", label(pl).c_str(), r.opt_prompts, r.stray);
		std::printf("ok   raigeki %s: all opponents destroyed, unchanged\n", label(pl).c_str());
	}
}

static void flow_assert() {
	Plan pl = ffa3(); pl.mon[1] = 1; pl.mon[2] = 3;
	{
		const Result r = play(pl, "assertu");
		const auto l = find_line(r, "assert");
		EXPECT(l.size() == 3 && l[1] == "false" && l[2] == "false", "assertu: line '%s', want 'assert false false'", join(l).c_str());
		EXPECT(r.opt_prompts == 0, "assertu: %d pick prompt(s), want none (no prompt for an assert)", r.opt_prompts);
		EXPECT(kind_count(r.nfold, 'U') == 1, "assertu: %d trap U record(s), want 1", kind_count(r.nfold, 'U'));
		std::printf("ok   assertu: unbound operation, false, trap U, no prompt\n");
	}
	{
		const Result r = play(pl, "assertb");
		const auto l = find_line(r, "assert");
		EXPECT(l.size() == 3 && l[1] == "true" && l[2] == "true", "assertb: line '%s', want 'assert true true'", join(l).c_str());
		EXPECT(r.opt_prompts == 1 && r.opt_before_op == 1, "assertb: %d pick(s), %d before the operation", r.opt_prompts, r.opt_before_op);
		EXPECT(kind_count(r.nfold, 'U') == 0, "assertb: trap U with a bound opponent");
		std::printf("ok   assertb: bound at activation, true\n");
	}
}

static void flow_w16() {
	Plan pl = ffa3(); pl.mon[1] = 1; pl.mon[2] = 3;
	const Result r = play(pl, "w16");
	const auto cond = find_lines(r, "w16cond");
	const auto l = find_line(r, "w16");
	EXPECT(!cond.empty(), "w16: the condition of the other effect never ran (IsPlayerCanRemove)");
	for(const auto& c : cond)
		EXPECT(c.size() == 2 && c[1] == "4", "w16: another card's condition read %s, want 4 (a closed window: every opponent)", c.size() == 2 ? c[1].c_str() : "?");
	EXPECT(l.size() == 3 && l[1] == "3" && l[2] == "3", "w16: window reads '%s', want 'w16 3 3' (the window is still open after the error)", join(l).c_str());
	EXPECT(r.stray >= 1, "w16: the Lua error of the test card was not logged (the error path did not run)");
	EXPECT(r.map_empty && r.scopes_empty, "w16: map or scopes not empty at the end");
	std::printf("ok   w16: the window is not copied into another card's condition; an error there leaves it open for the caller\n");
}

static void flow_err() {
	for(const char* v : { "err", "errt" }) {
		for(Plan pl : { ffa3(), ffa4() }) {
			pl.mon[1] = 1; pl.mon[2] = 3; if(pl.n == 4) pl.mon[3] = 2;
			const Result r = play(pl, v);
			const std::string key = std::string(v) == "err" ? "cost" : "tg";
			const int total = pl.n == 3 ? 4 : 6;
			bool seen3 = false;
			for(const auto& l : find_lines(r, key)) {
				if(l.size() == 3 && l[1] == "3") {
					seen3 = true;
					EXPECT(std::stoi(l[2]) == total, "%s %s: the check after the error read %s, want %d (the window of the failed check leaked)", v, label(pl).c_str(), l[2].c_str(), total);
				}
				if(l.size() == 3 && l[1] == "1")
					EXPECT(std::stoi(l[2]) == total, "%s %s: first run read %s, want %d", v, label(pl).c_str(), l[2].c_str(), total);
			}
			EXPECT(seen3, "%s %s: the check after the failed one never ran", v, label(pl).c_str());
			EXPECT(r.stray >= 1, "%s %s: the Lua error was not logged", v, label(pl).c_str());
			EXPECT(r.map_empty && r.scopes_empty, "%s %s: map or scopes not empty", v, label(pl).c_str());
			std::printf("ok   %s %s: the check after a Lua error in a window sees a closed window\n", v, label(pl).c_str());
		}
	}
}

static void flow_coerr() {
	Plan pl = ffa3(); pl.mon[1] = 1; pl.mon[2] = 3;
	const Result r = play(pl, "coerr");
	const auto l = find_line(r, "co");
	EXPECT(l.size() == 3 && l[1] == "3" && l[2] == "3", "coerr: reads '%s', want 'co 3 3' (the window survives the prompt)", join(l).c_str());
	EXPECT(r.stray >= 1, "coerr: the Lua error was not logged");
	EXPECT(r.map_empty, "coerr: the window map still has an entry after the coroutine failed");
	EXPECT(r.scopes_empty, "coerr: scope stack not empty");
	std::printf("ok   coerr: a coroutine that fails after a prompt leaves no saved window\n");
}


// Review fix 1 (HIGH): the check of the activation reads the window or binds in its first run (nothing bound yet)
static void flow_probe_checks() {
	struct Case { const char* name; Plan pl; const char* v; std::vector<int> mon; bool offered; int prompts; const char* op; };
	std::vector<Case> cases;
	for(const char* v : { "tgwin", "tgbind", "conassert" }) {
		const bool win = std::string(v) == "tgwin";
		// tgwin: a window read of "at least one monster"; the others: "at least two monsters"
		const int lo = win ? 0 : 1;   // a seat that fails the check: 0 monsters (tgwin) or 1 monster
		cases.push_back({ v, ffa3(), v, { 2, lo, 3 }, true, 0, "op true 3" });
		cases.push_back({ v, ffa3(), v, { 2, 3, 4 }, true, 1, "op true 4" });
		cases.push_back({ v, ffa3(), v, { 2, lo, lo }, false, 0, "" });
		cases.push_back({ v, ffa4(), v, { 2, lo, lo, 5 }, true, 0, "op true 5" });
		cases.push_back({ v, ffa4(), v, { 2, 3, lo, 5 }, true, 1, "op true 5" });
	}
	// the SUM passes the first run, but no single opponent does: not offered
	cases.push_back({ "tgbind, sum only", ffa3(), "tgbind", { 2, 1, 1 }, false, 0, "" });
	cases.push_back({ "conassert, sum only", ffa3(), "conassert", { 2, 1, 1 }, false, 0, "" });
	for(auto& c : cases) {
		for(int i = 0; i < 4; ++i) c.pl.mon[i] = i < static_cast<int>(c.mon.size()) ? c.mon[i] : 0;
		const Result r = play(c.pl, c.v);
		const auto l = find_line(r, "op");
		EXPECT(r.offered == c.offered, "probe %s [%s]: offered=%d, want %d", c.name, label(c.pl).c_str(), r.offered, c.offered);
		EXPECT(r.opt_prompts == c.prompts, "probe %s [%s]: %d pick prompt(s), want %d", c.name, label(c.pl).c_str(), r.opt_prompts, c.prompts);
		if(c.offered) EXPECT(!l.empty() && join(l) == c.op, "probe %s [%s]: op line '%s', want '%s'", c.name, label(c.pl).c_str(), join(l).c_str(), c.op);
		EXPECT(kind_count(r.nfold, 'c') == 0 && kind_count(r.nfold, 'U') == 0 && kind_count(r.nfold, 'W') == 0, "probe %s [%s]: NFOLD %s", c.name, label(c.pl).c_str(), join(r.nfold).c_str());
		EXPECT(r.stray == 0 && r.map_empty && r.scopes_empty, "probe %s [%s]: stray %d map %d scopes %d", c.name, label(c.pl).c_str(), r.stray, r.map_empty, r.scopes_empty);
		std::printf("ok   probe %s [%s]: offered %d, prompts %d, op '%s'\n", c.name, label(c.pl).c_str(), r.offered, r.opt_prompts, join(l).c_str());
	}
}

// Review fix 2: a function of the same effect inside a ONE window (a filter that gets the effect as an argument)
static void flow_nested() {
	for(Plan pl : { ffa3(), ffa4() }) {
		pl.mon[1] = 1; pl.mon[2] = 3; if(pl.n == 4) pl.mon[3] = 2;
		const Result r = play(pl, "nested");
		const auto rows = find_lines(r, "nest");
		EXPECT(r.done && !find_line(r, "nestdone").empty(), "nested %s: the operation did not finish", label(pl).c_str());
		EXPECT(!rows.empty(), "nested %s: the filter never ran", label(pl).c_str());
		for(const auto& l : rows)
			EXPECT(l.size() == 2 && l[1] == "3", "nested %s: the filter read %s, want 3 (the bound opponent, seat 2)", label(pl).c_str(), l.size() == 2 ? l[1].c_str() : "?");
		EXPECT(kind_count(r.nfold, 'W') == 0 && kind_count(r.nfold, 'c') == 0, "nested %s: NFOLD %s", label(pl).c_str(), join(r.nfold).c_str());
		EXPECT(r.stray == 0 && r.map_empty && r.scopes_empty, "nested %s: stray %d map %d scopes %d", label(pl).c_str(), r.stray, r.map_empty, r.scopes_empty);
		std::printf("ok   nested %s: the filter of the same effect reads the bound opponent (%zu call(s))\n", label(pl).c_str(), rows.size());
	}
}

// Review fix 3: player-value reads inside a window with no seat
static void flow_emptywin() {
	for(Plan pl : { ffa3(), ffa4() }) {
		pl.mon[1] = 1; pl.mon[2] = 3; if(pl.n == 4) pl.mon[3] = 2;
		const Result r = play(pl, "emptywin");
		const auto l = find_line(r, "emptywin");
		EXPECT(r.done && l.size() == 3 && l[1] == "nil" && l[2] == "0", "emptywin %s: reads '%s', want 'emptywin nil 0'", label(pl).c_str(), join(l).c_str());
		EXPECT(r.opt_prompts == 0, "emptywin %s: %d pick prompt(s), want none (an empty window never asks)", label(pl).c_str(), r.opt_prompts);
		for(int q = 1; q < pl.n; ++q)
			EXPECT(r.hand[q] == pl.hand[q] + kStartHand, "emptywin %s: hand of seat %d = %d, want %d (nobody draws)", label(pl).c_str(), q, r.hand[q], pl.hand[q] + kStartHand);
		EXPECT(kind_count(r.nfold, 'W') >= 1, "emptywin %s: no trap W record", label(pl).c_str());
		EXPECT(kind_count(r.nfold, 'c') == 0 && kind_count(r.nfold, 'a') == 0, "emptywin %s: NFOLD %s", label(pl).c_str(), join(r.nfold).c_str());
		EXPECT(r.stray == 0 && r.map_empty && r.scopes_empty, "emptywin %s: stray %d map %d scopes %d", label(pl).c_str(), r.stray, r.map_empty, r.scopes_empty);
		std::printf("ok   emptywin %s: GetLP nil, no draw, no prompt inside a window with no seat\n", label(pl).c_str());
	}
}

// Review fix 3: MPBindOpponent inside a SEAT window (nothing bound) asks the pick and binds
static void flow_lazybind() {
	Plan pl = ffa3(); pl.mon[1] = 1; pl.mon[2] = 3;
	const Result r = play(pl, "lazybind");
	const auto l = find_line(r, "lb");
	EXPECT(r.done && l.size() == 3 && l[1] == "true" && l[2] == "true", "lazybind: reads '%s', want 'lb true true' (bound by the pick)", join(l).c_str());
	EXPECT(r.opt_prompts == 1, "lazybind: %d pick prompt(s), want 1 (a SEAT window is no binding)", r.opt_prompts);
	std::printf("ok   lazybind: MPBindOpponent in a SEAT window still asks and binds\n");
}

// ---------------------------------------------------------------------------------------------- Part A / B: by hand
struct Cfg {
	uint8_t P = 0;
	uint8_t own_bound = DUELIST_NONE;
	bool exclusive = false;
	bool open = false;
	uint8_t kind = interpreter::MPW_ONE;
	uint8_t seat = DUELIST_NONE;
	effect* eff = nullptr;
};
struct Hand {
	OCG_Duel d;
	interpreter* I;
	explicit Hand(OCG_Duel dd) : d(dd), I(static_cast<duel*>(dd)->lua) {}
	void push(const Cfg& c) {
		I->push_scope(c.P);
		auto* s = I->current_scope();
		s->own_bound = c.own_bound;
		s->exclusive = c.exclusive;
		s->eff = c.eff;
		s->mp.open = c.open;
		s->mp.kind = c.kind;
		s->mp.seat = c.seat;
	}
	void pop() { I->pop_scope(); }
	std::vector<int> seats(uint32_t loc, uint8_t self = 0) {
		field::range_list rl;
		sd::F(d).build_range_list(rl, self, 0, loc);
		std::vector<int> out;
		for(uint32_t i = 1; i < rl.count; ++i)   // entry 0 is the own side (loc1 = 0)
			if(rl.loc[i] & loc) out.push_back(rl.who[i]);
		std::sort(out.begin(), out.end());
		return out;
	}
};
static std::vector<int> all_opp(const Plan& pl) {
	std::vector<int> v;
	for(int q = 1; q < pl.n; ++q) if(!pl.tag || (q % 2) == 1) v.push_back(q);
	return v;
}

static void check_seats(const char* what, const std::string& fmt, const std::vector<int>& got, const std::vector<int>& want) {
	EXPECT(got == want, "%s [%s]: seats %s, want %s", what, fmt.c_str(), ints(got).c_str(), ints(want).c_str());
}

static void part_a(const Plan& pl) {
	const std::string f = label(pl);
	OCG_Duel d = build(pl);
	decorate(d, pl);
	Hand h(d);
	const auto opp = all_opp(pl);
	const uint8_t B = static_cast<uint8_t>(opp[1]);   // the bound opponent (the second one), Tag: seat 3
	const uint8_t S = static_cast<uint8_t>(opp[0]);   // a SEAT window seat, never the bound one
	Cap cap;
	auto run = [&](const char* name, Cfg c, std::vector<int> field, std::vector<int> ind) {
		h.push(c);
		check_seats(name, f + " field", h.seats(LOCATION_MZONE), field);
		check_seats(name, f + " hand", h.seats(LOCATION_HAND), ind);
		h.pop();
	};
	// ---- stock: no window, no exclusive. The field class reads every opponent, the individual class the bound one (F5)
	{ Cfg c; c.own_bound = B; run("plain, bound", c, opp, { B }); }
	{ Cfg c; run("plain, nothing bound", c, opp, opp); }
	// ---- exclusive (summon procedure): one bound opponent on both classes, in Tag too (T4)
	{ Cfg c; c.own_bound = B; c.exclusive = true; run("exclusive, bound", c, { B }, { B }); }
	{ Cfg c; c.exclusive = true; run("exclusive, nothing bound: stock", c, opp, opp); }
	// ---- W6: the bound seat is dead: an empty side, no widening to the others
	{
		sd::F(d).player[B].eliminated = true;
		Cfg c; c.own_bound = B; c.exclusive = true; run("exclusive, dead bound seat (W6)", c, {}, {});
		Cfg c2; c2.own_bound = B; c2.open = true; run("ONE window, dead bound seat (W6)", c2, pl.tag ? std::vector<int>{ S } : std::vector<int>{}, std::vector<int>{});
		sd::F(d).player[B].eliminated = false;
	}
	// ---- the ONE window: FFA reads the bound seat only, Tag keeps the joined field (the individual class keeps the F5 rule)
	{ Cfg c; c.own_bound = B; c.open = true; run("ONE window, bound", c, pl.tag ? opp : std::vector<int>{ B }, { B }); }
	cap.begin();
	{ Cfg c; c.open = true; run("ONE window, no seat (W14)", c, pl.tag ? opp : std::vector<int>{}, pl.tag ? opp : std::vector<int>{}); }
	{
		const auto nf = cap.end();
		// FFA: the field read and the hand read are two records. Tag: the gate lets the window through unseen, no record
		const int want = pl.tag ? 0 : 2;
		EXPECT(kind_count(nf, 'W') == want, "ONE window, no seat [%s]: %d trap W record(s), want %d", f.c_str(), kind_count(nf, 'W'), want);
	}
	// ---- the SEAT window: one duelist, in FFA and in Tag, whatever is bound
	{ Cfg c; c.own_bound = B; c.open = true; c.kind = interpreter::MPW_SEAT; c.seat = S; run("SEAT window", c, { S }, { S }); }
	{ Cfg c; c.open = true; c.kind = interpreter::MPW_SEAT; c.seat = S; c.exclusive = true; c.own_bound = B; run("SEAT window beats exclusive", c, { S }, { S }); }
	{
		sd::F(d).player[S].eliminated = true;
		Cfg c; c.open = true; c.kind = interpreter::MPW_SEAT; c.seat = S; run("SEAT window, dead seat", c, {}, {});
		sd::F(d).player[S].eliminated = false;
	}
	// a seat of the own team (FFA: the activator, Tag: the partner)
	{ Cfg c; c.open = true; c.kind = interpreter::MPW_SEAT; c.seat = pl.tag ? 2 : 0; run("SEAT window, own team seat", c, {}, {}); }
	// ---- W15 Tag: the ONE window does not hide the exclusive rule
	{ Cfg c; c.own_bound = B; c.exclusive = true; c.open = true; run("ONE window + exclusive", c, { B }, { B }); }
	// ---- overlays and counters follow the same helper
	{
		auto sum = [&](const std::vector<int>& seats, const int* arr) { int s = 0; for(int q : seats) s += arr[q]; return s; };
		const int total_ov = sum(opp, pl.ov), total_ct = sum(opp, pl.ctr);
		auto read = [&](const char* name, Cfg c, int want_ov, int want_ct) {
			h.push(c);
			const int ov = sd::F(d).get_overlay_count(0, 0, 1, nullptr);
			const int ct = static_cast<int>(sd::F(d).get_field_counter(0, 0, 1, 0x1));
			card_set cs;
			sd::F(d).get_overlay_group(0, 0, 1, &cs, nullptr);
			h.pop();
			EXPECT(ov == want_ov && ct == want_ct && static_cast<int>(cs.size()) == want_ov, "%s [%s]: overlays %d (group %zu) counters %d, want %d and %d", name, f.c_str(), ov, cs.size(), ct, want_ov, want_ct);
		};
		Cfg plain; plain.own_bound = B;
		read("overlay/counter plain", plain, total_ov, total_ct);
		Cfg one = plain; one.open = true;
		read("overlay/counter ONE window", one, pl.tag ? total_ov : pl.ov[B], pl.tag ? total_ct : pl.ctr[B]);
		Cfg seat = plain; seat.open = true; seat.kind = interpreter::MPW_SEAT; seat.seat = S;
		read("overlay/counter SEAT window", seat, pl.ov[S], pl.ctr[S]);
		Cfg none; none.open = true;
		cap.begin();
		read("overlay/counter ONE window, no seat", none, pl.tag ? total_ov : 0, pl.tag ? total_ct : 0);
		const auto nf = cap.end();
		EXPECT(kind_count(nf, 'W') == (pl.tag ? 0 : 3), "overlay/counter ONE window, no seat [%s]: %d trap W record(s), want %d", f.c_str(), kind_count(nf, 'W'), pl.tag ? 0 : 3);
		Cfg ex; ex.own_bound = B; ex.exclusive = true;
		read("overlay/counter exclusive", ex, pl.ov[B], pl.ctr[B]);
	}
	// ---- review fix 4: the core lists of a field effect (OPP_EXCL) never follow a window; the exclusive rule they keep
	{
		auto seats_use = [&](Cfg c, uint8_t use) {
			h.push(c);
			field::range_list rl;
			sd::F(d).build_range_list(rl, 0, 0, LOCATION_MZONE, use);
			std::vector<int> out;
			for(uint32_t i = 1; i < rl.count; ++i) if(rl.loc[i] & LOCATION_MZONE) out.push_back(rl.who[i]);
			std::sort(out.begin(), out.end());
			h.pop();
			return out;
		};
		Cfg win; win.own_bound = B; win.open = true;
		Cfg seat; seat.open = true; seat.kind = interpreter::MPW_SEAT; seat.seat = S;
		Cfg ex; ex.own_bound = B; ex.exclusive = true;
		Cfg both = win; both.exclusive = true;
		check_seats("ONE window, core list (OPP_EXCL)", f, seats_use(win, field::OPP_EXCL), opp);
		check_seats("SEAT window, core list (OPP_EXCL)", f, seats_use(seat, field::OPP_EXCL), opp);
		check_seats("exclusive, core list (OPP_EXCL)", f, seats_use(ex, field::OPP_EXCL), { B });
		check_seats("exclusive, window list (OPP_WINDOW)", f, seats_use(ex, field::OPP_WINDOW), opp);
		check_seats("ONE window, window list (OPP_WINDOW)", f, seats_use(win, field::OPP_WINDOW), pl.tag ? opp : std::vector<int>{ B });
		check_seats("SEAT window, window list (OPP_WINDOW)", f, seats_use(seat, field::OPP_WINDOW), { S });
		check_seats("ONE window + exclusive, core list (OPP_EXCL)", f, seats_use(both, field::OPP_EXCL), { B });
		// a real field effect: filter_affected_cards and filter_inrange_cards under a window read every opponent monster
		auto* pd = static_cast<duel*>(d);
		card* host = nullptr;
		for(auto* c : sd::F(d).player[0].list_mzone) if(c) { host = c; break; }
		if(host) {
			effect* e = pd->new_effect();
			e->owner = host;
			e->handler = host;
			e->type = EFFECT_TYPE_FIELD;
			e->s_range = 0;
			e->o_range = LOCATION_MZONE;
			size_t total = 0;
			for(int q : opp) total += static_cast<size_t>(pl.mon[q]);
			for(const auto& [what, c] : { std::pair<const char*, Cfg>{ "no window", Cfg{} }, { "ONE window", win }, { "SEAT window", seat } }) {
				h.push(c);
				card_set aff, inr;
				sd::F(d).filter_affected_cards(e, &aff);
				sd::F(d).filter_inrange_cards(e, &inr);
				h.pop();
				EXPECT(aff.size() == total && inr.size() == total, "field effect lists, %s [%s]: affected %zu, in range %zu, want %zu", what, f.c_str(), aff.size(), inr.size(), total);
			}
		}
	}
	// the self side never changes: partner cards stay readable in Tag (loc1 side)
	{
		Cfg c; c.own_bound = B; c.open = true; c.kind = interpreter::MPW_SEAT; c.seat = S;
		h.push(c);
		field::range_list rl;
		sd::F(d).build_range_list(rl, 0, LOCATION_MZONE, 0);
		std::vector<int> own;
		for(uint32_t i = 0; i < rl.count; ++i) own.push_back(rl.who[i]);
		std::sort(own.begin(), own.end());
		h.pop();
		check_seats("self side under a SEAT window", f, own, pl.tag ? std::vector<int>{ 0, 2 } : std::vector<int>{ 0 });
	}
	OCG_DestroyDuel(d);
	std::printf("ok   part A %s: build_range_list, overlays, counters under none, ONE, SEAT, exclusive, dead, no seat\n", f.c_str());
}

// Lua in a scope that was pushed by hand (not yieldable, nothing bound, not pinned)
static std::vector<std::string> lua_lines(Hand& h, const Cfg& c, const std::string& code) {
	std::vector<std::string> out;
	sd::on_line = [&](const std::string& t) { out.push_back(t); };
	h.push(c);
	sd::lua(h.d, code);
	h.pop();
	sd::on_line = nullptr;
	return out;
}
static void part_b(const Plan& pl) {
	const std::string f = label(pl);
	OCG_Duel d = build(pl);
	decorate(d, pl);
	Hand h(d);
	auto& F = sd::F(d);
	const auto opp = all_opp(pl);
	Cap cap;
	cap.begin();
	// basics
	{
		auto l = lua_lines(h, Cfg{}, "Debug.Message('CHK mode '..Duel.MPMode()..' bound '..tostring(Duel.MPBound())..' count '..Duel.MPOppCount())");
		const std::string want = "CHK mode " + std::string(pl.tag ? "2" : "1") + " bound false count " + std::to_string(opp.size());
		EXPECT(l.size() == 1 && l[0] == want, "basics [%s]: '%s', want '%s'", f.c_str(), l.empty() ? "" : l[0].c_str(), want.c_str());
	}
	// W11: a scope that cannot ask. Trap build: a Lua error. Release: false. Never a prompt.
	{
		const size_t before = F.core.select_options.size();
		auto l = lua_lines(h, Cfg{}, "local ok,r=pcall(Duel.MPBindOpponent,true) Debug.Message('CHK bind '..tostring(ok)..' '..tostring(r)..' bound '..tostring(Duel.MPBound()))");
		EXPECT(F.core.select_options.size() == before && F.core.select_options.empty(), "W11 [%s]: a pick prompt was queued in a scope that cannot ask", f.c_str());
		EXPECT(l.size() == 1, "W11 [%s]: %zu line(s)", f.c_str(), l.size());
		if(!l.empty()) {
#ifdef YGO_N_TRAP
			EXPECT(l[0].compare(0, 14, "CHK bind false") == 0, "W11 [%s]: '%s', want a Lua error (pcall false)", f.c_str(), l[0].c_str());
#else
			EXPECT(l[0] == "CHK bind true false bound false", "W11 [%s]: '%s', want 'bind true false' (release: false, no error)", f.c_str(), l[0].c_str());
#endif
		}
	}
	// Tag with needs_pick == false binds nothing and gives true (no mode check needed in FFA: it asks)
	if(pl.tag) {
		auto l = lua_lines(h, Cfg{}, "Debug.Message('CHK nopick '..tostring(Duel.MPBindOpponent(false))..' '..tostring(Duel.MPBound()))");
		EXPECT(l.size() == 1 && l[0] == "CHK nopick true false", "Tag needs_pick=false [%s]: '%s', want 'CHK nopick true false'", f.c_str(), l.empty() ? "" : l[0].c_str());
	}
	// MPBindOpponent with one opponent legal binds silently (no prompt): eliminate all but the second opponent
	{
		for(int q : opp) if(q != opp[1]) F.player[q].eliminated = true;
		auto l = lua_lines(h, Cfg{}, "Debug.Message('CHK single '..tostring(Duel.MPBindOpponent(true))..' '..tostring(Duel.MPBound())..' '..Duel.MPOppCount())");
		EXPECT(l.size() == 1 && l[0] == "CHK single true true 1", "single legal opponent [%s]: '%s'", f.c_str(), l.empty() ? "" : l[0].c_str());
		EXPECT(F.core.select_options.empty(), "single legal opponent [%s]: a prompt was queued", f.c_str());
		for(int q : opp) F.player[q].eliminated = false;
	}
	// MPBindOpponent in a scope that is already bound: true, nothing asked
	{
		Cfg c; c.own_bound = static_cast<uint8_t>(opp[0]);
		auto l = lua_lines(h, c, "Debug.Message('CHK again '..tostring(Duel.MPBindOpponent(true))..' '..tostring(Duel.MPBound()))");
		EXPECT(l.size() == 1 && l[0] == "CHK again true true", "bound already [%s]: '%s'", f.c_str(), l.empty() ? "" : l[0].c_str());
		EXPECT(F.core.select_options.empty(), "bound already [%s]: a prompt was queued", f.c_str());
	}
	// MPNeedPick sets touched
	{
		h.push(Cfg{});
		F.pduel->lua->current_scope()->touched = false;
		sd::lua(d, "Duel.MPNeedPick()");
		EXPECT(F.pduel->lua->current_scope()->touched, "MPNeedPick [%s]: touched not set", f.c_str());
		h.pop();
	}
	// W18: MPAssertBound without a bound opponent in a scope that is not the probe
	{
		auto l = lua_lines(h, Cfg{}, "local ok,e=pcall(Duel.MPAssertBound) Debug.Message('CHK assert '..tostring(ok)..' '..tostring(e))");
		EXPECT(l.size() == 1, "W18 [%s]: %zu line(s)", f.c_str(), l.size());
		if(!l.empty()) {
#ifdef YGO_N_TRAP
			EXPECT(l[0].compare(0, 16, "CHK assert false") == 0, "W18 [%s]: '%s', want a Lua error", f.c_str(), l[0].c_str());
#else
			EXPECT(l[0] == "CHK assert true false", "W18 [%s]: '%s', want 'assert true false' (release: false, no error)", f.c_str(), l[0].c_str());
#endif
		}
		Cfg c; c.own_bound = static_cast<uint8_t>(opp[0]);
		l = lua_lines(h, c, "Debug.Message('CHK assert '..tostring(Duel.MPAssertBound()))");
		EXPECT(l.size() == 1 && l[0] == "CHK assert true", "W18 bound [%s]: '%s'", f.c_str(), l.empty() ? "" : l[0].c_str());
	}
	// W14: a window with no seat. An EMPTY side and a trap W record. The sum over every opponent is never read.
	{
		auto l = lua_lines(h, Cfg{}, "Duel.MPWindow(0) local a=Duel.GetFieldGroupCount(0,0,LOCATION_MZONE) Duel.MPWindowEnd() local b=Duel.GetFieldGroupCount(0,0,LOCATION_MZONE) Debug.Message('CHK w14 '..a..' '..b)");
		int total = 0;
		for(int q : opp) total += pl.mon[q];
		const std::string want = "CHK w14 " + std::to_string(pl.tag ? total : 0) + " " + std::to_string(total);
		EXPECT(l.size() == 1 && l[0] == want, "W14 [%s]: '%s', want '%s'", f.c_str(), l.empty() ? "" : l[0].c_str(), want.c_str());
	}
	// MPWindow(i): the i-th living opponent in turn order after P. P = 1 (FFA: 2, 3, 0; Tag: 2 is its partner: 3 is its only member)
	{
		Cfg c; c.P = 1;
		// in Tag the Lua player value is the team id: the own side of seat 1 is value 1
		const std::string me = pl.tag ? "1" : "0";
		auto l = lua_lines(h, c, "local t={} for i=1,Duel.MPOppCount()+1 do Duel.MPWindow(i) t[#t+1]=Duel.GetFieldGroupCount(" + me + ",0,LOCATION_MZONE) Duel.MPWindowEnd() end Debug.Message('CHK order '..table.concat(t,','))");
		// with P = 1: opponents in turn order. FFA3: 2, 0. FFA4: 2, 3, 0. Tag: team of 1 is {1,3}; opponents 2, 0 (turn order 2 then 0)
		std::vector<int> order;
		for(int k = 1; k < pl.n; ++k) { const int q = (1 + k) % pl.n; if(pl.tag ? (q % 2) == 0 : true) order.push_back(q); }
		std::string want = "CHK order ";
		for(size_t k = 0; k < order.size(); ++k) want += (k ? "," : "") + std::to_string(pl.mon[order[k]]);
		want += ",0";   // one more than there are opponents: an empty side
		EXPECT(l.size() == 1 && l[0] == want, "MPWindow order [%s]: '%s', want '%s'", f.c_str(), l.empty() ? "" : l[0].c_str(), want.c_str());
	}
	// review fix 2: a check function of the SAME effect, run from inside a scope of that effect with a ONE window open,
	// gets the window and the bound opponent (a condition of another effect gets neither). Scope pushed by hand,
	// the condition is run by effect::is_condition_check.
	{
		card* host = nullptr;
		for(auto* c : F.player[0].list_mzone) if(c) { host = c; break; }
		auto* pd = static_cast<duel*>(d);
		auto* L = pd->lua->current_state;
		sd::lua(d, "nestf=function(e) Debug.Message('CHK nest '..Duel.GetFieldGroupCount(0,0,LOCATION_MZONE)) return true end");
		auto make = [&]() {
			effect* e = pd->new_effect();
			e->owner = host;
			e->handler = host;
			e->type = EFFECT_TYPE_FIELD;
			lua_getglobal(L, "nestf");
			e->condition = luaL_ref(L, LUA_REGISTRYINDEX);
			return e;
		};
		if(host) {
			effect* same = make();
			effect* other = make();
			int total = 0;
			for(int q : opp) total += pl.mon[q];
			const uint8_t B = static_cast<uint8_t>(opp[1]);
			auto run = [&](const char* name, effect* scope_eff, int want) {
				Cfg c; c.own_bound = B; c.open = true; c.eff = scope_eff;
				std::vector<std::string> out;
				sd::on_line = [&](const std::string& t) { out.push_back(t); };
				h.push(c);
				same->is_condition_check(0, F.nil_event);
				other->is_condition_check(0, F.nil_event);
				h.pop();
				sd::on_line = nullptr;
				// the first line is the condition of `same`, the second the one of `other`
				EXPECT(out.size() == 2, "nested condition, %s [%s]: %zu line(s), want 2", name, f.c_str(), out.size());
				if(out.size() == 2) {
					const std::string w1 = "CHK nest " + std::to_string(want);
					const std::string w2 = "CHK nest " + std::to_string(total);
					EXPECT(out[0] == w1, "nested condition of the same effect, %s [%s]: '%s', want '%s'", name, f.c_str(), out[0].c_str(), w1.c_str());
					EXPECT(out[1] == w2, "nested condition of another effect, %s [%s]: '%s', want '%s' (no window)", name, f.c_str(), out[1].c_str(), w2.c_str());
				}
			};
			run("ONE window", same, pl.tag ? total : pl.mon[B]);
		}
	}
	// review fix 5: the release list of the other side follows the window (GetReleaseGroupCount with oppo = true)
	{
		const int own = pl.mon[0];
		const uint8_t B = static_cast<uint8_t>(opp[1]), S = static_cast<uint8_t>(opp[0]);
		int total = 0;
		for(int q : opp) total += pl.mon[q];
		auto rel = [&](const char* name, Cfg c, int want) {
			auto l = lua_lines(h, c, "Debug.Message('CHK rel '..Duel.GetReleaseGroupCount(0,false,true)..' '..#Duel.GetReleaseGroup(0,false,true))");
			const std::string w = "CHK rel " + std::to_string(want) + " " + std::to_string(want);
			EXPECT(l.size() == 1 && l[0] == w, "release list, %s [%s]: '%s', want '%s'", name, f.c_str(), l.empty() ? "" : l[0].c_str(), w.c_str());
		};
		rel("no window", Cfg{}, own + total);
		{ Cfg c; c.own_bound = B; c.open = true; rel("ONE window", c, own + (pl.tag ? total : pl.mon[B])); }
		{ Cfg c; c.open = true; c.kind = interpreter::MPW_SEAT; c.seat = S; rel("SEAT window", c, own + pl.mon[S]); }
		{ Cfg c; c.open = true; c.kind = interpreter::MPW_SEAT; rel("SEAT window, no seat", c, own); }
	}
	// review fix 6: the argument of MPWindow is read as an integer, not as a byte (257 is no seat, not seat 1)
	{
		auto l = lua_lines(h, Cfg{}, "local t={} for _,v in ipairs({257,256,4294967297,-1,255,1000}) do Duel.MPWindow(v) t[#t+1]=Duel.GetFieldGroupCount(0,0,LOCATION_MZONE) Duel.MPWindowEnd() end Debug.Message('CHK arg '..table.concat(t,','))");
		EXPECT(l.size() == 1 && l[0] == "CHK arg 0,0,0,0,0,0", "MPWindow argument range [%s]: '%s', want 'CHK arg 0,0,0,0,0,0' (an empty side each)", f.c_str(), l.empty() ? "" : l[0].c_str());
	}
	// MPWindowEnd closes: no window left in the scope
	{
		h.push(Cfg{});
		sd::lua(d, "Duel.MPWindow(1) Duel.MPWindowEnd()");
		EXPECT(!F.pduel->lua->current_scope()->mp.open, "MPWindowEnd [%s]: the window is still open", f.c_str());
		h.pop();
	}
	const auto nf = cap.end();
	// FFA: W14 (one record) and the out-of-range MPWindow of the order test (one). Tag: the ONE window of W14 is ignored, so only the order test
	EXPECT(kind_count(nf, 'W') >= (pl.tag ? 1 : 2), "part B [%s]: trap W records %d, want at least %d", f.c_str(), kind_count(nf, 'W'), pl.tag ? 1 : 2);
	OCG_DestroyDuel(d);
	std::printf("ok   part B %s: API in a scope that cannot ask (W11, W14, W18, order, single opponent)\n", f.c_str());
}

// n == 2: no scope is ever pushed. No mode, no window, everything is true or empty.
static void part_n2() {
	OCG_Duel d = sd::create("");
	std::vector<std::string> l;
	sd::on_line = [&](const std::string& t) { l.push_back(t); };
	sd::lua(d, "Debug.Message('CHK n2 '..Duel.MPMode()..' '..tostring(Duel.MPBound())..' '..Duel.MPOppCount()..' '..tostring(Duel.MPWindow(0))..' '..tostring(Duel.MPBindOpponent(true))..' '..tostring(Duel.MPAssertBound())) Duel.MPWindowEnd() Duel.MPNeedPick()");
	sd::on_line = nullptr;
	EXPECT(l.size() == 1 && l[0] == "CHK n2 0 false 0 false true true", "n == 2: '%s', want 'CHK n2 0 false 0 false true true'", l.empty() ? "" : l[0].c_str());
	EXPECT(sd::stray_logs == 0, "n == 2: stray log lines");
	OCG_DestroyDuel(d);
	std::printf("ok   n == 2: MPMode 0, no window, no scope\n");
}

int main() {
	sd::scripts[kFiller] = "local s,id=GetID()\nfunction s.initial_effect(c) end\n";
	Plan units[3] = { ffa3(), ffa4(), tag4() };
	for(auto& p : units) {
		// seat s has s+1 monsters (the partner of a Tag has 3), overlays 2 s, counters 3 s: every seat is different
		for(int s = 0; s < p.n; ++s) { p.mon[s] = s + 1; p.ov[s] = 2 * s; p.ctr[s] = 3 * s; p.hand[s] = 2 + s; }
	}
	for(const auto& p : units) part_a(p);
	for(const auto& p : units) part_b(p);
	part_n2();
	flow_window();
	flow_anyloop();
	flow_seat();
	flow_place();
	flow_raigeki();
	flow_assert();
	flow_w16();
	flow_err();
	flow_coerr();
	flow_probe_checks();
	flow_nested();
	flow_emptywin();
	flow_lazybind();
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
