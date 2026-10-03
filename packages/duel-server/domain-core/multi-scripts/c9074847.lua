if not aux.MPForEachDuelist then return end
-- Return all monsters to the hand, then each duelist Special Summons face-down as many monsters from its hand as it had returned (R1, Q3).
-- The count is kept per real seat (Duel.MPSeatOf of the returned card, a key that does not change with the loop). Tag partner included.
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(Card.IsAbleToHand,tp,LOCATION_MZONE,LOCATION_MZONE,nil)
	if #g==0 then return end
	Duel.SendtoHand(g,nil,REASON_EFFECT)
	Duel.BreakEffect()
	local ct={}
	for c in aux.Next(Duel.GetOperatedGroup()) do
		if c:IsLocation(LOCATION_HAND) then
			local seat=Duel.MPSeatOf(c)
			ct[seat]=(ct[seat] or 0)+1
		end
	end
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local n=ct[seat_i] or 0
		if n==0 then return end
		Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_SPSUMMON)
		local sg=Duel.SelectMatchingCard(tp_i,s.spfilter,tp_i,LOCATION_HAND,0,n,n,nil,e,tp_i)
		for tc in aux.Next(sg) do
			Duel.SpecialSummonStep(tc,0,tp_i,tp_i,false,false,POS_FACEDOWN_DEFENSE)
		end
	end)
	Duel.SpecialSummonComplete()
end
