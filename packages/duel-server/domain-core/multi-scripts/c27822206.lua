if not aux.MPKey then return end
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	for tc in eg:Iter() do
		local prev_p=tc:GetPreviousControler()
		local own_side=aux.MPKey(rp)==aux.MPKey(prev_p)
		if tc:IsPreviousLocation(LOCATION_MZONE) and tc:IsReason(REASON_DESTROY) and tc:IsReason(REASON_EFFECT)
			and ((re:IsSpellEffect() and own_side) or not own_side) then
			Duel.RegisterFlagEffect(prev_p,id,RESET_PHASE|PHASE_END,0,1)
		end
	end
end
