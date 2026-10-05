if not aux.MPChooseOpponent then return end
-- Lilith, Lady of Lament: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.thop(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(s.thfilter,tp,LOCATION_DECK,0,nil)
	if #g>=3 then
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SET)
		local sg=g:Select(tp,3,3,nil)
		if not aux.MPChooseOpponent(tp) then return end
		Duel.ConfirmCards(1-tp,sg)
		Duel.ShuffleDeck(tp)
		Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_SET)
		local tg=sg:Select(1-tp,1,1,nil)
		Duel.SSet(tp,tg:GetFirst(),tp,false)
	end
end
