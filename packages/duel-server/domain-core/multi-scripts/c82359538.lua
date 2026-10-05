if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.rthcon(e,tp,eg,ep,ev,re,r,rp)
	local ch=Duel.MPPreviousChain()
	return e:GetHandler():IsFacedown() and ch>0 and ep==1-tp and Duel.GetChainInfo(ch,CHAININFO_TRIGGERING_CONTROLER)==tp
end
