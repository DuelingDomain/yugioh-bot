if not aux.MPAny then return end
-- Painful Choice: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	if Duel.GetFieldGroupCount(tp,LOCATION_DECK,0)<5 then return end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_CONFIRM)
	local g=Duel.SelectMatchingCard(tp,aux.AND(Card.IsAbleToHand,Card.IsAbleToGrave),tp,LOCATION_DECK,0,5,5,nil)
	if #g~=5 then return end
	local opp=1-tp
	if not aux.MPChooseOpponent(tp) then return end
	Duel.ConfirmCards(opp,g)
	Duel.Hint(HINT_SELECTMSG,opp,aux.Stringid(id,1))
	local sg=g:Select(opp,1,1,nil)
	if Duel.SendtoHand(sg,nil,REASON_EFFECT)>0 then
		Duel.SendtoGrave(g-sg,REASON_EFFECT)
	end
end
