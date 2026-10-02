if not aux.MPForEachDuelist then return end
-- A picked opponent reveals one copy; every living duelist then gains 2000 LP.
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local opp=1-tp
	if Duel.IsExistingMatchingCard(s.revealfilter,opp,LOCATION_HAND|LOCATION_DECK,0,1,nil)
		and Duel.SelectYesNo(opp,aux.Stringid(id,2)) then
		Duel.Hint(HINT_SELECTMSG,opp,HINTMSG_CONFIRM)
		local sc=Duel.SelectMatchingCard(opp,s.revealfilter,opp,LOCATION_HAND|LOCATION_DECK,0,1,1,nil):GetFirst()
		Duel.ConfirmCards(tp,sc)
		if sc:IsLocation(LOCATION_HAND) then
			Duel.ShuffleHand(opp)
		else
			Duel.ShuffleDeck(opp)
		end
		aux.MPForEachDuelist(function(tp_i) Duel.Recover(tp_i,2000,REASON_EFFECT) end)
	else
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
		local g=Duel.SelectMatchingCard(tp,nil,tp,0,LOCATION_MZONE,1,1,nil)
		if #g>0 then
			Duel.HintSelection(g)
			Duel.Destroy(g,REASON_EFFECT)
		end
	end
end
-- Both effects must bind during their target step, before an opponent answers or receives the card.
s.target=aux.MPTarget(s.target)
s.activate=aux.MPOne(s.activate)
s.thtg=aux.MPTarget(s.thtg)
s.thop=aux.MPOne(s.thop)
