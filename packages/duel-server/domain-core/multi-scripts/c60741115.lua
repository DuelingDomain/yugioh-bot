if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- A living link keeps resolving after its source link is removed. Preserve independent actions.
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local cid=Duel.GetChainInfo(ev,CHAININFO_CHAIN_ID)
	if not cid then return end
	--damage conversion
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetType(EFFECT_TYPE_FIELD)
	e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	e1:SetCode(EFFECT_REVERSE_DAMAGE)
	e1:SetTargetRange(1,1)
	e1:SetValue(s.rev)
	e1:SetReset(RESET_CHAIN)
	e1:SetLabel(cid)
	Duel.RegisterEffect(e1,tp)
end
