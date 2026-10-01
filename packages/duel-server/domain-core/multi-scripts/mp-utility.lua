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

-- Chooser card, target or cost step with chk: chk==0 asks for the pick (MPPick), the real step binds and runs in window ONE (MPOne).
function aux.MPTarget(fn)
	local pick,one=aux.MPPick(fn),aux.MPOne(fn)
	return function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
		if chk==0 then return pick(e,tp,eg,ep,ev,re,r,rp,chk,chkc) end
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
