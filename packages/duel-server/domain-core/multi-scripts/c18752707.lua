if not aux.MPAny then return end
-- Magical Star Illusion: the condition asks if any one opponent controls at least as many monsters.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)<=Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end)()
end
