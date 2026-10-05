if not aux.MPAny then return end
-- Monster Assortment: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local dg=Duel.GetMatchingGroup(s.filter,tp,LOCATION_DECK,0,nil)
	local g=aux.SelectUnselectGroup(dg,e,tp,2,2,s.check,1,tp,HINTMSG_CONFIRM)
	if #g==2 then
		if not aux.MPChooseOpponent(tp) then return end
		Duel.ConfirmCards(1-tp,g)
		Duel.ShuffleDeck(tp)
		Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_ATOHAND)
		local tc=g:Select(1-tp,1,1,nil):GetFirst()
		Duel.SendtoHand(tc,nil,REASON_EFFECT)
	end
end
