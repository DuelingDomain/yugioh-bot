if not aux.MPChooseOpponent then return end
-- Voici la Carte (Today's Menu): the deciding opponent is chosen during resolution (rulebook v1.4).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(s.revfilter,tp,LOCATION_DECK,0,nil)
	if #g<2 then return end
	local sg=aux.SelectUnselectGroup(g,e,tp,2,2,aux.dncheck,1,tp,HINTMSG_CONFIRM)
	if not aux.MPChooseOpponent(tp) then return end
	Duel.ConfirmCards(1-tp,sg)
	Duel.Hint(HINT_SELECTMSG,1-tp,aux.Stringid(id,1))
	local g=sg:Select(1-tp,1,1,nil)
	if #g>0 and Duel.SendtoHand(g,nil,REASON_EFFECT)>0 then
		Duel.ShuffleDeck(tp)
		local rac=g:GetFirst():GetRace()
		if Duel.IsExistingMatchingCard(aux.NecroValleyFilter(s.thfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,nil,rac)
			and Duel.SelectYesNo(tp,aux.Stringid(id,2)) then
			Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
			local tc=Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.thfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil,rac)
			if #tc>0 then
				Duel.BreakEffect()
				Duel.SendtoHand(tc,nil,REASON_EFFECT)
				Duel.ConfirmCards(1-tp,tc)
			end
		end
	end
end
