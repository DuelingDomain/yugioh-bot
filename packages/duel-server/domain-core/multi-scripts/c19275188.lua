if not aux.MPAny then return end
-- War Rock Generations: the condition asks if any one opponent controls more monsters.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return Duel.IsBattlePhase() and aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0) end)()
end
