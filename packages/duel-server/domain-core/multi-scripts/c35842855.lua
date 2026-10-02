if not aux.MPForEachDuelist then return end
-- After the destruction every duelist takes damage equal to half of the ATK (R1, Q3, Tag partner included).
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if tc:IsRelateToEffect(e) and Duel.Destroy(tc,REASON_EFFECT)==1 then
		local atk=tc:GetTextAttack()/2
		if atk>0 then
			aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,atk,REASON_EFFECT,true) end)
			Duel.RDComplete()
		end
	end
end
