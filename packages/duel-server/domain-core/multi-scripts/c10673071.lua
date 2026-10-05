if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.discon(e,tp,eg,ep,ev,re,r,rp)
	local chainlink=Duel.MPPreviousChain(true)
	if not (chainlink>0 and Duel.IsChainDisablable(ev) and ep==1-tp) then return false end
	local trig_player,trig_type=Duel.GetChainInfo(chainlink,CHAININFO_TRIGGERING_PLAYER,CHAININFO_TRIGGERING_TYPE)
	return trig_player==tp and (trig_type&TYPE_FUSION)>0
end
