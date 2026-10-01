if not aux.MPKey then return end
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	local cid=Duel.GetCurrentChain()
	if cid>0 and r&REASON_COST==REASON_COST then
		s[0],s[1]=Duel.GetChainInfo(cid,CHAININFO_CHAIN_ID),Duel.GetChainInfo(cid,CHAININFO_TRIGGERING_LOCATION)
		local seq=Duel.GetChainInfo(cid,CHAININFO_TRIGGERING_SEQUENCE)
		local te=Duel.GetChainInfo(cid,CHAININFO_TRIGGERING_EFFECT)
		local tc,p=te:GetHandler(),e:GetHandler():GetControler()
		if tc:IsRelateToEffect(te) then
			if aux.MPKey(tc:GetControler())~=aux.MPKey(p) then seq=seq+16 end
		else
			if aux.MPKey(tc:GetPreviousControler())~=aux.MPKey(p) then seq=seq+16 end
		end
		s[2]=seq
	end
end
