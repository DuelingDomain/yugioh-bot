if not aux.MPAny then return end
-- Three in One: the activation condition asks if any one opponent has more cards in the hand and on the field. In the End Phase of any opponent turn.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return Duel.IsPhase(PHASE_END) and Duel.IsTurnPlayer(1-tp)
		and aux.MPAny(function() return Duel.GetFieldGroupCount(1-tp,LOCATION_HAND|LOCATION_ONFIELD,0)>Duel.GetFieldGroupCount(tp,LOCATION_HAND|LOCATION_ONFIELD,0) end)()
end
