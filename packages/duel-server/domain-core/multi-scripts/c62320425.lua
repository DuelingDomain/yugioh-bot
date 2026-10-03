if not aux.MPForEachDuelist then return end
-- Every duelist sends the top 5 cards of its Deck to the GY (R1, Q3, Tag partner included). The target needs every duelist to be able to.
-- The later choice "you or your opponent sends 5 more" stays stock.
function s.tgtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDiscardDeck(tp_i,5) end) end
	Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,PLAYER_ALL,5)
end
function s.tgop(e,tp,eg,ep,ev,re,r,rp)
	local sent=0
	aux.MPForEachDuelist(function(tp_i) sent=sent+Duel.DiscardDeck(tp_i,5,REASON_EFFECT) end)
	if sent<=0
		or not Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_GRAVE,0,1,nil,CARD_EXCHANGE_SPIRIT) then return end
	local b1=Duel.IsPlayerCanDiscardDeck(tp,5)
	local b2=Duel.IsPlayerCanDiscardDeck(1-tp,5)
	if (b1 or b2) and Duel.SelectYesNo(tp,aux.Stringid(id,3)) then
		local op=Duel.SelectEffect(tp,
			{b1,aux.Stringid(id,4)},
			{b2,aux.Stringid(id,5)})
		Duel.BreakEffect()
		Duel.DiscardDeck(op==1 and tp or 1-tp,5,REASON_EFFECT)
	end
end
