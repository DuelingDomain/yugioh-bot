if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- A living link keeps resolving after its source link is removed. Preserve independent actions.
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local p=Duel.GetChainInfo(ev,CHAININFO_TARGET_PLAYER)
	if p==nil then return end
	Duel.ChangeTargetPlayer(ev,1-p)
end
