if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- A living link keeps resolving after its source link is removed. Preserve independent actions.
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	Duel.DiscardHand(1-tp,nil,1,1,REASON_EFFECT|REASON_DISCARD)
	local cid=Duel.GetChainInfo(ev,CHAININFO_CHAIN_ID)
	if not cid then return end
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetType(EFFECT_TYPE_FIELD)
	e1:SetCode(EFFECT_CHANGE_DAMAGE)
	e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	e1:SetTargetRange(1,0)
	e1:SetLabel(cid)
	e1:SetValue(s.refcon)
	e1:SetReset(RESET_CHAIN)
	Duel.RegisterEffect(e1,tp)
end
