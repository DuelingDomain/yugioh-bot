if not aux.MPChooseOpponent then return end
-- Vaalmonica Scelta: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.activate(e,tp,eg,ep,ev,re,r,rp,angello_or_dimonno) --Additional parameter used by "Angello Vaalmonica" and "Dimonno Vaalmonica"
	local op=nil
	if angello_or_dimonno then
		op=angello_or_dimonno
	else
		local sel_player=Duel.IsExistingMatchingCard(Card.IsSetCard,tp,LOCATION_PZONE,0,1,nil,SET_VAALMONICA) and tp or 1-tp
		local offset=sel_player==1-tp and 2 or 0
		if sel_player==1-tp and not aux.MPChooseOpponent(tp) then return end
		op=Duel.SelectEffect(sel_player,
			{true,aux.Stringid(id,1+offset)},
			{true,aux.Stringid(id,2+offset)})
	end
	if op==1 then
		--Gain 500 LP and draw 2 cards
		local g=Duel.GetMatchingGroup(Card.IsAbleToDeck,tp,LOCATION_HAND,0,nil)
		if Duel.Recover(tp,500,REASON_EFFECT)>0 and #g>0 and Duel.IsPlayerCanDraw(tp,2)
			and Duel.SelectYesNo(tp,aux.Stringid(id,5)) then
			Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TODECK)
			local sc=g:Select(tp,1,1,nil):GetFirst()
			Duel.BreakEffect()
			if not (Duel.SendtoDeck(sc,nil,SEQ_DECKBOTTOM,REASON_EFFECT)>0 and sc:IsLocation(LOCATION_DECK)) then return end
			Duel.Draw(tp,2,REASON_EFFECT)
		end
	elseif op==2 then
		--Take 500 damage and search 1 "Valmonica" Spell/Trap
		local g=Duel.GetMatchingGroup(s.thfilter,tp,LOCATION_DECK,0,nil)
		if Duel.Damage(tp,500,REASON_EFFECT)>0 and #g>0 and Duel.SelectYesNo(tp,aux.Stringid(id,6)) then
			Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
			local sg=g:Select(tp,1,1,nil)
			Duel.BreakEffect()
			Duel.SendtoHand(sg,nil,REASON_EFFECT)
			Duel.ConfirmCards(1-tp,sg)
		end
	end
end
