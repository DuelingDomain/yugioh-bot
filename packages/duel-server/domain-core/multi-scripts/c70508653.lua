if not aux.MPChooseOpponent then return end
-- Tool Box: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.thop(e,tp,eg,ep,ev,re,r,rp)
	if not e:GetHandler():IsRelateToEffect(e) then return end
	local rvg=Duel.GetMatchingGroup(s.eqpfilter,tp,LOCATION_DECK,0,nil)
	local g=aux.SelectUnselectGroup(rvg,e,tp,2,2,aux.dncheck,1,tp,HINTMSG_CONFIRM)
	if #g==2 then
		if not aux.MPChooseOpponent(tp) then return end
		Duel.ConfirmCards(1-tp,g)
		Duel.ShuffleDeck(tp)
		Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_ATOHAND)
		local sg=g:Select(1-tp,1,1,nil)
		Duel.SendtoHand(sg,tp,REASON_EFFECT)
		g:RemoveCard(sg)
		Duel.ShuffleDeck(tp)
		Duel.MoveToDeckBottom(g,tp)
	end
end
