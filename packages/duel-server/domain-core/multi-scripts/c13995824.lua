if not aux.MPForEachDuelist then return end
-- Every duelist sends the top 7 cards of its Deck to the GY (R1, Q3, Tag partner included).
function s.ddop(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i) Duel.DiscardDeck(tp_i,7,REASON_EFFECT) end)
end
