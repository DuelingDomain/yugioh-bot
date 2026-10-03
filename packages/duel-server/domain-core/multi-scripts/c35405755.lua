if not aux.MPKey then return end
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	local loc,p=Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_LOCATION,CHAININFO_TRIGGERING_CONTROLER)
	local tc=re:GetHandler()
	if re:IsMonsterEffect() and tc:IsRelateToEffect(re) and loc==LOCATION_MZONE and aux.MPKey(p)~=aux.MPKey(Duel.GetTurnPlayer()) then
		tc:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)
	end
end
