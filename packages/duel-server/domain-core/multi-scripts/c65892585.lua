if Duel.MPMode()~=1 then return end
-- R-FFA-LP-COMPARE: unanimous living-opponent conditions; stock amounts/actions.
function s.thop(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
	local thc=Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil):GetFirst()
	if not (thc and Duel.SendtoHand(thc,nil,REASON_EFFECT)>0 and thc:IsLocation(LOCATION_HAND)) then return end
	Duel.ConfirmCards(1-tp,thc)
	local g=Duel.GetMatchingGroup(s.tgfilter,tp,LOCATION_DECK,0,nil)
	if aux.MPCompareLP(tp,"<") and #g>0 and Duel.SelectYesNo(tp,aux.Stringid(id,2)) then
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)
		local gyg=Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil)
		if #gyg>0 then
			Duel.BreakEffect()
			Duel.SendtoGrave(gyg,REASON_EFFECT)
		end
	end
end
