MP_OVERLAY_ACTIVE = true
if not Duel.MPBindOpponent then return end
-- Helpers for the multiplayer card overlay (F7, design 2.A.7). Loaded at 3 or 4 seats only, after utility.lua and domain.lua.
-- Duel.MPMode(): 0 = two seats, 1 = free-for-all, 2 = Tag. Each helper returns fn itself at two seats.

-- TRUE/FALSE checks only. Condition-safe: it never asks. Nothing bound: it runs fn once per living opponent
-- and is true when ANY one opponent passes. Bound: it runs fn once on the bound opponent.
-- Tag: the opposing team is one joined side, so fn runs once with no window.
function aux.MPAny(fn)
	return function(...)
		if Duel.MPMode()~=1 then return fn(...) end
		if Duel.MPBound() then
			Duel.MPWindow(0)
			local r=fn(...)
			Duel.MPWindowEnd()
			return r
		end
		Duel.MPNeedPick()
		for i=1,Duel.MPOppCount() do
			Duel.MPWindow(i)
			local r=fn(...)
			Duel.MPWindowEnd()
			if r then return true end
		end
		return false
	end
end

-- NUMBERS (a count or a sum that is used as ct). The link MUST have a bound opponent: this never loops.
function aux.MPValue(fn)
	return function(...)
		if Duel.MPMode()~=1 then return fn(...) end
		Duel.MPAssertBound()
		Duel.MPWindow(0)
		local r=fn(...)
		Duel.MPWindowEnd()
		return r
	end
end

-- Cost, target or operation step: bind one opponent (it may ask), then run fn.
-- FFA: window ONE around the whole fn. Tag: it binds and opens no window (the joined opposing field).
function aux.MPOne(fn)
	return function(...)
		if Duel.MPMode()==0 then return fn(...) end
		Duel.MPBindOpponent(true)
		if Duel.MPMode()==2 then return fn(...) end
		Duel.MPWindow(0)
		local r=fn(...)
		Duel.MPWindowEnd()
		return r
	end
end

-- Chooser card, condition or target (chk==0): the activator picks the opponent at activation (FFA and Tag).
function aux.MPPick(fn)
	return function(...)
		if Duel.MPMode()~=0 and not Duel.MPBound() then Duel.MPNeedPick() end
		return fn(...)
	end
end

-- Chooser card, target or cost step with chk. The real step (chk~=0) binds and runs in window ONE (MPOne).
-- chk==0, nothing bound: the first run asks for the pick (MPPick); fn sees every opponent, so it only tells that SOME opponent has a legal target.
-- chk==0, bound (the per-opponent probe run, or a link that is already bound): fn runs in window ONE (MPOne), so an opponent with no legal target is not offered in the pick.
function aux.MPTarget(fn)
	local pick,one=aux.MPPick(fn),aux.MPOne(fn)
	return function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
		if chk==0 and not (Duel.MPMode()~=0 and Duel.MPBound()) then return pick(e,tp,eg,ep,ev,re,r,rp,chk,chkc) end
		return one(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	end
end

-- "All" or "each" opponent cards, and continuous (ADJUST) cards: fn(i,...) runs once per living opponent.
-- Seat windows work in FFA and in Tag: one duelist per run, never the joined field. Two seats: fn(0,...) once.
function aux.MPEachOpponent(fn)
	return function(...)
		if Duel.MPMode()==0 then return fn(0,...) end
		for i=1,Duel.MPOppCount() do
			Duel.MPWindow(i)
			fn(i,...)
			Duel.MPWindowEnd()
		end
	end
end

-- R1 "each duelist" (Q3) and R2 "state per seat" (Q6). They need the seat functions of core patch 0053 (Duel.MPNthDuelist, MPSeat,
-- MPSeatOf, MPBindSeat). Without them, or at two seats, each helper does the stock thing and never rebinds.

-- The team id of every seat, read once at load (no scope yet, so Duel.MPSeat gives the team in Tag and the seat in FFA).
local mp_team_of={}
if Duel.MPSeat and Duel.MPMode()~=0 then
	for seat=0,3 do mp_team_of[seat]=Duel.MPSeat(seat) end
end
-- (the formats put the seats of a Tag team on alternate seats: the fallback when the table has no entry)
local function mp_team(seat) return mp_team_of[seat] or seat%2 end

-- Runs fn(tp_i,seat_i) once for every LIVING duelist in turn order from the duelist that runs the effect (the Tag partner is one too,
-- a defeated duelist is skipped). tp_i is the Lua player value of that duelist (FFA: 0, Tag: its team id), seat_i its real seat.
-- Inside fn the scope is that duelist: write "tp_i" where the stock script writes "tp" and "1-tp_i" for its opponent. fn uses only
-- tp_i and seat_i, never a value read before the loop (it was read for another duelist). fn returns true to stop the loop.
-- The loop gives the scope back (Duel.MPNthDuelist(0)) on every exit: the end, a stop, and a prompt inside fn keeps the rebind.
-- A Lua error is closed by the core (scope_guard). Two seats (or no seat functions): fn(0,0) for the duelist, then fn(1,1) for the other.
function aux.MPForEachDuelist(fn)
	if Duel.MPMode()==0 or not Duel.MPNthDuelist then
		if not fn(0,0) then fn(1,1) end
		return
	end
	local tag=Duel.MPMode()==2
	local i=1
	while true do
		local ok,seat=Duel.MPNthDuelist(i)
		if not ok then break end
		local stop=fn(tag and mp_team(seat) or 0,seat)
		if stop then break end
		i=i+1
	end
	Duel.MPNthDuelist(0)
end

-- True when fn(tp_i,seat_i) is true for every living duelist (the loop stops at the first false). Same rules for fn as in MPForEachDuelist.
function aux.MPAllDuelists(fn)
	local all=true
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if not fn(tp_i,seat_i) then all=false return true end
	end)
	return all
end

-- True when fn(tp_i,seat_i) is true for at least one living duelist (the loop stops at the first true).
function aux.MPAnyDuelist(fn)
	local any=false
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if fn(tp_i,seat_i) then any=true return true end
	end)
	return any
end

-- The key of a player value p for a flag or a table that is kept per player: the seat in FFA, the team in Tag (Q6).
-- Without Duel.MPSeat (or at two seats) it is p itself.
function aux.MPKey(p)
	if Duel.MPSeat and Duel.MPMode()~=0 then return Duel.MPSeat(p) end
	return p
end

-- The key (as aux.MPKey gives it) of a real seat: the seat in FFA, the team in Tag. aux.MPKey(tp) before a loop and
-- aux.MPKeyOfSeat(seat_i) inside it tell if a duelist is on the side of the effect (equal) or an opponent (different).
function aux.MPKeyOfSeat(seat)
	if Duel.MPMode()==2 then return mp_team(seat) end
	return seat
end

-- The Lua value of the own side of the duelist that runs the effect: FFA 0, Tag its team id. A seat that Duel.MPBindSeat accepts is a
-- living opponent, so the own team is the other one. It leaves no bind behind.
local function mp_own_value()
	if Duel.MPMode()~=2 then return 0 end
	local own=0
	for seat=0,3 do
		if Duel.MPBindSeat(seat) then own=1-mp_team(seat) break end
	end
	Duel.MPBindSeat()
	return own
end

-- "The controller of the card" reads: fn(sg,seat,p) runs once for every real controller seat of the cards in g, in seat order.
-- sg is the part of g that this duelist controls, seat the real seat (Duel.MPSeatOf), p the Lua player value of the controller
-- (the value that c:GetControler() gives). For an opponent controller the Lua value 1 is bound to that seat (Duel.MPBindSeat) while fn
-- runs, so Duel.Damage(p,...) and the other reads of "1" reach that duelist, not "the next opponent". The own side (Tag: the partner
-- too) runs with no bind. A controller that is not a living duelist is skipped. fn returns true to stop. The bind is removed on every
-- exit (it replaces a bind that the caller made). Two seats (or no seat functions): the same loop with the real controller, no bind.
function aux.MPForEachController(g,fn)
	local order={}
	local by={}
	for c in aux.Next(g) do
		local seat=Duel.MPSeatOf and Duel.MPSeatOf(c) or c:GetControler()
		if seat>=0 then
			if not by[seat] then
				by[seat]=Group.CreateGroup()
				order[#order+1]=seat
			end
			by[seat]:AddCard(c)
		end
	end
	table.sort(order)
	local bind=Duel.MPBindSeat and Duel.MPMode()~=0
	local own=bind and mp_own_value()
	for _,seat in ipairs(order) do
		local sg=by[seat]
		local p=sg:GetFirst():GetControler()
		local ok=true
		if bind then
			if p==own then Duel.MPBindSeat() else ok=Duel.MPBindSeat(seat) end
		end
		if ok and fn(sg,seat,p) then break end
	end
	if bind then Duel.MPBindSeat() end
end
