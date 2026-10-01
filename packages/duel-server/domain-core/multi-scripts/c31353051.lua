if not aux.MPForEachDuelist then return end
-- After the destruction every duelist takes 2000 damage (R1, Q3, Tag partner included).
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if c:IsRelateToEffect(e) and Duel.Destroy(c,REASON_EFFECT)>0 then
		Duel.BreakEffect()
		aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,2000,REASON_EFFECT,true) end)
		Duel.RDComplete()
	end
end
