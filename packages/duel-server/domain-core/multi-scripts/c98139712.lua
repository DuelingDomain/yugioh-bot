if not aux.MPForEachDuelist or not Duel.MPOwnerSeat then return end
-- Owner 2026-10-18: The damage belongs to the real owner of each event card, including stolen cards.
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(p,seat)
		local count=eg:FilterCount(function(c) return Duel.MPOwnerSeat(c)==seat end,nil)
		if count>0 then Duel.Damage(p,count*300,REASON_EFFECT,true) end
	end)
	Duel.RDComplete()
end
