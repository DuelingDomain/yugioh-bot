if not aux.MPForEachDuelist then return end
-- After the destruction every duelist takes 1000 damage (R1, Q3, Tag partner included).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if tc:IsFaceup() and tc:IsRelateToEffect(e) then
		if Duel.Destroy(tc,REASON_EFFECT)>0 then
			aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,1000,REASON_EFFECT,true) end)
			Duel.RDComplete()
		end
	end
end
