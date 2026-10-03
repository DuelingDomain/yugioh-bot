if not aux.MPKey then return end
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	local cid=Duel.GetCurrentChain()
	if cid>0 and r&REASON_COST==REASON_COST then
		s[0],s[1]=Duel.GetChainInfo(cid,CHAININFO_CHAIN_ID),Duel.GetChainInfo(cid,CHAININFO_TRIGGERING_LOCATION)
		local seq=Duel.GetChainInfo(cid,CHAININFO_TRIGGERING_SEQUENCE)
		local te=Duel.GetChainInfo(cid,CHAININFO_TRIGGERING_EFFECT)
		local tc=te:GetHandler()
		s.mp_detach_seat=tc:IsRelateToEffect(te) and Duel.MPSeatOf(tc) or tc:GetPreviousControler()
		s[2]=seq
	end
end
-- Each holder compares the real detach controller with its own linked zones.
function s.descon(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	local loc,seq=s[1],s[2]
	if c:IsStatus(STATUS_BATTLE_DESTROYED) or not seq then return false end
	if s.mp_detach_seat~=Duel.MPSeatOf(c) then seq=seq+16 end
	return Duel.GetChainInfo(ev,CHAININFO_CHAIN_ID)==s[0]
		and re:IsActiveType(TYPE_XYZ) and (loc&LOCATION_MZONE)~=0 and bit.extract(c:GetLinkedZone(),seq)~=0
end
