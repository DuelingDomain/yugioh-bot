if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- A living link keeps resolving after its source link is removed. Preserve independent actions.
function s.op(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not c:IsRelateToEffect(e) then return end
	local p=Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_CONTROLER)
	if p==nil then return end
	if Duel.CallCoin(p) then
		Duel.SendtoGrave(c,REASON_EFFECT)
	elseif Duel.NegateActivation(ev) and re:GetHandler():IsRelateToEffect(re) then
		Duel.GetControl(re:GetHandler(),1-p)
	end
end
