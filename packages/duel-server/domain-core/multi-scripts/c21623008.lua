if not aux.MPForEachDuelist then return end
-- Every duelist sends the top 2 cards of its Deck to the GY (R1, Q3, Tag partner included). The target needs every duelist to be able to.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDiscardDeck(tp_i,2) end) end
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i) Duel.DiscardDeck(tp_i,2,REASON_EFFECT) end)
	if Duel.IsExistingMatchingCard(Card.IsSpell,tp,LOCATION_GRAVE,0,3,nil)
		and Duel.IsExistingMatchingCard(s.filter,tp,0,LOCATION_MZONE,1,nil)
		and Duel.SelectYesNo(tp,aux.Stringid(id,0)) then
		local g=Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_MZONE,nil)
		Duel.SendtoDeck(g,nil,SEQ_DECKTOP,REASON_EFFECT)
	end
end
