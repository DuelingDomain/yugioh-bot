if not aux.MPForEachDuelist then return end
-- Every duelist takes half of the ATK as damage (R1, Q3, Tag partner included).
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	local val=tc:GetAttack()//2
	if tc:IsRelateToEffect(e) and val>0 then
		aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,val,REASON_EFFECT,true) end)
		Duel.RDComplete()
	end
end
