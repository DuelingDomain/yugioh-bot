-- Owner 2026-10-18: five pieces in ONE hand win the whole duel (the whole team in Tag).
if not aux.MPForEachDuelist then return end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(p)
		local g=Duel.GetFieldGroup(p,LOCATION_HAND,0)
		if not s.check(g) then return end
		Duel.ConfirmCards(1-p,g)
		Duel.Win(p,WIN_REASON_EXODIA)
		return true
	end)
end
