if not aux.MPAny then return end
-- Snake-Eyes Diabellstar: a duelist that is gone (eliminated) is not a Lua error. OQ3: a dead bound opponent means "no effect".
-- s.checkzones asks Duel.GetLocationCount(owner,LOCATION_SZONE) for the owner of each battling monster. The owner of the monster of
-- an opponent is the Lua value 1, and at 3 or 4 seats that value is bound to a real seat. When that duelist is eliminated before
-- the trigger is checked or resolved, the bound seat is dead and the core gives NO value for it (not 0), so the stock
-- comparison "nothing > 0" stopped the duel with a script error. A zone count that is missing is 0 here: no free zone, no effect.
function s.checkzones(c0,c1)
	local p0,p1=c0:GetOwner(),c1:GetOwner()
	local n0=Duel.GetLocationCount(p0,LOCATION_SZONE) or 0
	if p0==p1 then return n0>1 end
	local n1=Duel.GetLocationCount(p1,LOCATION_SZONE) or 0
	return n0>0 and n1>0
end
