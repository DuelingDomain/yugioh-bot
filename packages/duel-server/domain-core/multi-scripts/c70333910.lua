if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- A living link keeps resolving after its source link is removed. Preserve independent actions.
function s.disop(e,tp,eg,ep,ev,re,r,rp)
	local mp_targets=Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)
	if not mp_targets then return end
	Duel.NegateEffect(ev)
	local c=e:GetHandler()
	local tg=mp_targets:Filter(s.tfilter,nil,tp)
	for tc in aux.Next(tg) do
		--Cannot be targeted by opponent's card effects
		local e1=Effect.CreateEffect(c)
		e1:SetDescription(3061)
		e1:SetType(EFFECT_TYPE_SINGLE)
		e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
		e1:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE+EFFECT_FLAG_CLIENT_HINT)
		e1:SetValue(aux.tgoval)
		e1:SetReset(RESETS_STANDARD_PHASE_END)
		tc:RegisterEffect(e1)
	end
end
