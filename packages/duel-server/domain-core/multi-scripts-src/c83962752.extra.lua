-- stock: s.desgroup[0] and s.desgroup[1] keep the Synchro Monsters of the player 0 and 1 that were destroyed. The registering effect is
-- global and sees the real seats, so it loops over all four seats. The groups are kept per key (seat in FFA, team in Tag) and are not
-- reset at the turn end (the stock script does not). "Destroyed by an opponent's effect" compares the keys of the two seats.
function s.mp_cfilter(c,p,e)
	local rp=c:GetReasonPlayer()
	return c:IsType(TYPE_SYNCHRO) and c:IsPreviousPosition(POS_FACEUP)
		and c:IsPreviousLocation(LOCATION_MZONE) and c:IsPreviousControler(p)
		and (c:IsReason(REASON_BATTLE) or (c:IsReason(REASON_EFFECT) and rp<=3 and aux.MPKeyOfSeat(rp)~=aux.MPKeyOfSeat(p)))
		and (not e or c:IsCanBeEffectTarget(e))
end
function s.desgroupregop(e,tp,eg,ep,ev,re,r,rp)
	for p=0,3 do
		local tg=eg:Filter(s.mp_cfilter,nil,p)
		if #tg>0 then
			for tc in tg:Iter() do
				tc:RegisterFlagEffect(id,RESET_CHAIN,0,1)
			end
			if Duel.GetCurrentChain()==0 then s.desgroup[p]:Clear() end
			s.desgroup[p]:Merge(tg)
			s.desgroup[p]:Remove(function(c) return c:GetFlagEffect(id)==0 end,nil)
			Duel.RaiseEvent(s.desgroup[p],EVENT_CUSTOM+id,re,r,rp,p,0)
		end
	end
end
