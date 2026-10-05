if not aux.MPAny then return end
-- Emerging Emergency Rescute Rescue: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	local lp=Duel.GetLP(tp)
	return aux.MPAnyOpponent(tp,function(p) return lp<Duel.GetLP(p) end)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(s.thfilter,tp,LOCATION_DECK,0,nil)
	if #g>=3 then
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
		local sg=g:Select(tp,3,3,nil)
		if not aux.MPChooseOpponent(tp) then return end
		Duel.ConfirmCards(1-tp,sg)
		Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_ATOHAND)
		local tg=sg:Select(1-tp,1,1,nil)
		Duel.SendtoHand(tg,nil,REASON_EFFECT)
		Duel.ConfirmCards(1-tp,tg)
	end
end
