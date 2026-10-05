if not aux.MPAny then return end
-- Gunkan Suship Catch-of-the-Day: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not c:AddCounter(0x20d,1) then return end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_CONFIRM)
	local g=Duel.SelectMatchingCard(tp,s.shipfilter,tp,LOCATION_EXTRA,0,1,1,nil)
	if #g==0 then return end
	if not aux.MPChooseOpponent(tp) then return end
	Duel.ConfirmCards(1-tp,g)
	Duel.ShuffleExtra(tp)
	local res=Duel.SelectCardsFromCodes(1-tp,1,1,false,false,suship_names)
	Duel.Hint(HINT_CARD,1-tp,res)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
	local sc=Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil,res)
	if #sc>0 then
		Duel.SendtoHand(sc,nil,REASON_EFFECT)
		Duel.ConfirmCards(1-tp,sc)
	elseif c:IsRelateToEffect(e) then
		Duel.SendtoDeck(c,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)
	end
end
