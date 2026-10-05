if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.spcon(e,tp,eg,ep,ev,re,r,rp)
	local ch=Duel.MPPreviousChain()
	if ch<=0 then return false end
	local cplayer=Duel.GetChainInfo(ch,CHAININFO_TRIGGERING_CONTROLER)
	local ceff=Duel.GetChainInfo(ch,CHAININFO_TRIGGERING_EFFECT)
	return ep==1-tp and cplayer==tp and ceff:GetHandler():IsSetCard(SET_PUNK)
end
