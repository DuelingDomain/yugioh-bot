if not aux.MPAny then return end
-- Ghost Reaper & Winter Cherries: the quick effect condition asks if any one opponent controls more monsters. The Extra Deck part is not a compare.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)<Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end)()
		and Duel.IsExistingMatchingCard(aux.TRUE,tp,LOCATION_EXTRA,0,1,nil)
end
