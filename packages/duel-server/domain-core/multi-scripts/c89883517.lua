if not aux.MPAny then return end
-- Mistaken Accusation: the activation condition asks if any one opponent has more cards in the hand and on the field.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAny(function()
		local ct1=Duel.GetFieldGroupCount(tp,LOCATION_ONFIELD|LOCATION_HAND,0)
		local ct2=Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD|LOCATION_HAND)
		return ct1<ct2
	end)()
end
