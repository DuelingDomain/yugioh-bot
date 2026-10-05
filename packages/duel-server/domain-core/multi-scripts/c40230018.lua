if not aux.MPChooseOpponent then return end
-- Spellbook Library of the Crescent: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(s.thfilter,tp,LOCATION_DECK,0,nil)
	if g:GetClassCount(Card.GetCode)>=3 then
		local revg=aux.SelectUnselectGroup(g,e,tp,3,3,aux.dncheck,1,tp,HINTMSG_CONFIRM)
		if not aux.MPChooseOpponent(tp) then return end
		Duel.ConfirmCards(1-tp,revg)
		Duel.ShuffleDeck(tp)
		Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_ATOHAND)
		local sg=revg:Select(1-tp,1,1,nil)
		if #sg>0 then
			Duel.SendtoHand(sg,nil,REASON_EFFECT)
		end
	end
end
