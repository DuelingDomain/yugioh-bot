if not aux.MPForEachDuelist then return end
-- Every duelist sends the top card of its Deck to the GY (R1, Q3, Tag partner included). The cost check needs every duelist to be able to.
function s.discost(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDiscardDeck(tp_i,1) end) end
	Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,PLAYER_ALL,1)
end
function s.disop(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i) Duel.DiscardDeck(tp_i,1,REASON_EFFECT) end)
end
