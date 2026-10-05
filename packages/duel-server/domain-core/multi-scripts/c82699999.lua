if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.discon(e,tp,eg,ep,ev,re,r,rp)
	local ch=Duel.MPPreviousChain(true)
	return ch>0 and ep==1-tp and Duel.IsChainDisablable(ev)
		and Chain.IsTriggeringPlayer(ch,tp)
		and Chain.IsTriggeringSetcode(ch,SET_LIVE_TWIN)
end
