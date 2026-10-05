if not aux.MPAny then return end
-- Beginning of Heaven and Earth: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(s.filter1,tp,LOCATION_DECK,0,nil)
	local sg=aux.SelectUnselectGroup(g,e,tp,3,3,s.rescon,1,tp,HINTMSG_ATOHAND)
	if #sg>0 then
		if not aux.MPChooseOpponent(tp) then return end
		Duel.ConfirmCards(1-tp,sg)
		Duel.ShuffleDeck(tp)
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SELECT)
		local tc=sg:Select(1-tp,1,1,nil):GetFirst()
		Duel.Hint(HINT_CARD,0,tc:GetCode())
		if s.filter2(tc) and tc:IsAbleToHand() then
			Duel.SendtoHand(tc,nil,REASON_EFFECT)
			sg:RemoveCard(tc)
		end
		Duel.SendtoGrave(sg,REASON_EFFECT)
	end
end
