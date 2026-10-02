if not aux.MPForEachDuelist then return end
-- After the destruction every duelist takes 500 damage (R1, Q3, Tag partner included).
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if tc:IsRelateToEffect(e) and Duel.Destroy(tc,REASON_EFFECT)~=0 then
		aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,500,REASON_EFFECT,true) end)
		Duel.RDComplete()
	end
end
