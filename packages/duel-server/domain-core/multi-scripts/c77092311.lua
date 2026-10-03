if not aux.MPForEachDuelist then return end
-- Every duelist sends the top 3 cards of its Deck to the GY (R1, Q3, Tag partner included). The target needs every duelist to be able to.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDiscardDeck(tp_i,3) end) end
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i) Duel.DiscardDeck(tp_i,3,REASON_EFFECT) end)
end
