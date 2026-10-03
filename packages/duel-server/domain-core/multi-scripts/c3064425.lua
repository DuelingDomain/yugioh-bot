if not aux.MPForEachDuelist then return end
-- The negate operation: after the destruction every duelist takes 1000 damage (R1, Q3, Tag partner included).
function s.negop(e,tp,eg,ep,ev,re,r,rp)
	if Duel.NegateActivation(ev) and re:GetHandler():IsRelateToEffect(re) and Duel.Destroy(eg,REASON_EFFECT)~=0 then
		Duel.BreakEffect()
		local g=Duel.GetMatchingGroup(aux.TRUE,tp,LOCATION_MZONE,LOCATION_MZONE,nil)
		if Duel.Destroy(g,REASON_EFFECT)==0 then return end
		aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,1000,REASON_EFFECT,true) end)
		Duel.RDComplete()
	end
end
