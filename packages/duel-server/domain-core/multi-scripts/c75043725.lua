if not aux.MPForEachDuelist then return end
-- Every duelist adds 1 Level 3 or lower Normal Monster from its own Deck to its hand and shows it to the others (R1, Q3, Tag partner
-- included). The picks are kept per real seat; the confirm runs in a second loop, after the cards moved.
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local pick={}
	local all=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i,seat_i)
		Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_ATOHAND)
		local tc=Duel.SelectMatchingCard(tp_i,s.filter,tp_i,LOCATION_DECK,0,1,1,nil):GetFirst()
		if tc then
			pick[seat_i]=tc
			all:AddCard(tc)
		end
	end)
	Duel.SendtoHand(all,nil,REASON_EFFECT)
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local others=all:Clone()
		if pick[seat_i] then others:RemoveCard(pick[seat_i]) end
		if #others>0 then Duel.ConfirmCards(tp_i,others) end
	end)
end
