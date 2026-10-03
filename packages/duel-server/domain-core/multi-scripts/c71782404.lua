if not aux.MPForEachDuelist then return end
-- Every duelist takes damage equal to the base ATK (R1, Q3, Tag partner included).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if tc:IsRelateToEffect(e) then
		local dam=tc:GetBaseAttack()
		aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,dam,REASON_EFFECT,true) end)
		Duel.RDComplete()
	end
end
