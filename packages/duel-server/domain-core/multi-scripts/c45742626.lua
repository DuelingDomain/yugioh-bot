if not aux.MPForEachDuelist then return end
-- Every duelist sends the top 5 cards of its Deck to the GY (R1, Q3, Tag partner included). The target needs every duelist to be able to.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDiscardDeck(tp_i,5) end) end
	Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,PLAYER_ALL,5)
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i) g:Merge(Duel.GetDecktopGroup(tp_i,5)) end)
	Duel.DisableShuffleCheck()
	Duel.SendtoGrave(g,REASON_EFFECT)
end
