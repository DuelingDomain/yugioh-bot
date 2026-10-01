if not aux.MPForEachDuelist then return end
-- Every duelist takes damage equal to the total ATK (R1, Q3, Tag partner included).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local tc1,tc2=Duel.GetFirstTarget()
	local dam=tc1:GetAttack()+tc2:GetAttack()
	if Duel.NegateAttack() then
		if tc1:IsRelateToEffect(e) and tc1:IsFaceup() and tc2:IsRelateToEffect(e) and tc2:IsFaceup() then
			aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,dam,REASON_EFFECT,true) end)
			Duel.RDComplete()
		end
	end
end
