if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- R-FFA-LP-COMPARE: the 2000-LP gap must hold against every living opponent,
-- including when the search/discard effect already has a chosen opponent.
function s.thop(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
	local g=Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)
	if #g>0 and Duel.SendtoHand(g,nil,REASON_EFFECT)>0 then
		Duel.ConfirmCards(1-tp,g)
		Duel.ShuffleHand(tp)
		Duel.ShuffleDeck(tp)
		if aux.MPCompareLP(tp,"<=",2000) and Duel.GetFieldGroupCount(tp,0,LOCATION_HAND)>0
			and Duel.SelectYesNo(tp,aux.Stringid(id,3)) then
			local sg=Duel.GetFieldGroup(tp,0,LOCATION_HAND):RandomSelect(1-tp,1)
			Duel.BreakEffect()
			Duel.SendtoGrave(sg,REASON_DISCARD|REASON_EFFECT)
		end
	end
end
