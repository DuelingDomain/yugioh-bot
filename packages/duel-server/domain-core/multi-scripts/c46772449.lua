if not aux.MPAny then return end
-- Evilswarm Exciton Knight: the quick effect condition asks if any one opponent has more cards in the hand and on the field.
function s.descon(e,tp,eg,ep,ev,re,r,rp)
	if not ((Duel.IsTurnPlayer(tp) and Duel.IsMainPhase()) or (Duel.IsTurnPlayer(1-tp) and Duel.IsBattlePhase())) then return false end
	return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_HAND|LOCATION_ONFIELD)>Duel.GetFieldGroupCount(tp,LOCATION_HAND|LOCATION_ONFIELD,0) end)()
end
