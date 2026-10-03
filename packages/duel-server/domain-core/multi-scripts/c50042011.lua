if not aux.MPKey then return end
-- At EVENT_DESTROY the previous controller of the card reads as the first seat for a monster of EVERY seat (live check: Card.IsPreviousControler
-- is true for seat 0 and false for the real seat), so the flag of a seat other than the first was never written. The card is still where it was
-- destroyed: the real controller seat (Duel.MPSeatOf) is the seat that controlled the monster.
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	local g=eg:Filter(s.checkfilter,nil)
	if #g==0 then return end
	local seen={}
	for tc in g:Iter() do
		local seat=Duel.MPSeatOf(tc)
		if seat>=0 and not seen[seat] then
			seen[seat]=true
			if not Duel.HasFlagEffect(seat,id) then
				Duel.RegisterFlagEffect(seat,id,RESET_PHASE|PHASE_END,0,1)
			end
		end
	end
end
