if not aux.MPKey then return end
function s.desgroupregop(e,tp,eg,ep,ev,re,r,rp)
	local tg=eg:Filter(s.spconfilter,nil)
	if #tg>0 then
		for tc in tg:Iter() do
			tc:RegisterFlagEffect(id,RESET_CHAIN,0,1)
		end
		if Duel.GetCurrentChain()==0 then s.desgroup:Clear() end
		s.desgroup:Merge(tg)
		s.desgroup:Remove(function(c) return not c:HasFlagEffect(id) end,nil)
		for seat=0,3 do
			if tg:IsExists(Card.IsPreviousControler,1,nil,seat) then
				local g=s.desgroup:Filter(Card.IsPreviousControler,nil,seat)
				Duel.RaiseEvent(g,EVENT_CUSTOM+id,re,r,rp,seat,ev)
			end
		end
	end
end
