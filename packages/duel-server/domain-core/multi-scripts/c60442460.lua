if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.negcon(e,tp,eg,ep,ev,re,r,rp)
	if not (ep==1-tp and Duel.IsChainDisablable(ev)) or re:GetHandler():IsDisabled() then return false end
	local ch=Duel.MPPreviousChain(true)
	if ch>0 then
		local cplayer=Duel.GetChainInfo(ch,CHAININFO_TRIGGERING_CONTROLER)
		local ceff=Duel.GetChainInfo(ch,CHAININFO_TRIGGERING_EFFECT)
		if cplayer==tp and ceff:GetHandler():IsSetCard(SET_BYSTIAL) and ceff:IsMonsterEffect() then
			return true
		end
	end
	if not re:IsHasProperty(EFFECT_FLAG_CARD_TARGET) then return false end
	local g=Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)
	if #g~=1 then return false end
	local tc=g:GetFirst()
	return tc:IsSetCard(SET_BYSTIAL) and tc:IsControler(tp) and tc:IsLocation(LOCATION_MZONE) and tc:IsFaceup()
end
