if not aux.MPForEachDuelist then return end
-- Every duelist gains 1000 LP (R1, Q3, Tag partner included).
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	if Duel.NegateActivation(ev) then
		if re:IsHasType(EFFECT_TYPE_ACTIVATE) and re:GetHandler():IsRelateToEffect(re) then
			Duel.SendtoGrave(eg,REASON_EFFECT)
		end
		aux.MPForEachDuelist(function(tp_i) Duel.Recover(tp_i,1000,REASON_EFFECT) end)
	end
end
