if not aux.MPAny then return end
-- Primathmech Laplacian (the Xyz Summon trigger): Trigger. The target asks the activator for the opponent; the operation runs in the window of that opponent.
-- The cost may detach up to one material per kind of card that the opponent has (hand, monster, Spell/Trap). The stock maximum reads the opponent
-- side as one: it is read in the window of the bound opponent here (FFA), so the activator cannot detach more materials than that opponent gives
-- effects to choose. Nothing bound (the check before the pick): the best opponent counts, as for any other check. Tag: the joined side, no window.
local stock_costmax=s.effcostmax
function s.effcostmax(e,tp)
	if not (Duel.MPMode and Duel.MPMode()==1) then return stock_costmax(e,tp) end
	if Duel.MPBound() then
		Duel.MPWindow(0)
		local r=stock_costmax(e,tp)
		Duel.MPWindowEnd()
		return r
	end
	local best=0
	for i=1,Duel.MPOppCount() do
		Duel.MPWindow(i)
		local r=stock_costmax(e,tp)
		Duel.MPWindowEnd()
		if r>best then best=r end
	end
	return best
end
s.efftg=aux.MPTarget(s.efftg)
s.effop=aux.MPOne(s.effop)
