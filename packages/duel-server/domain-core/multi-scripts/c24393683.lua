if not aux.MPAny then return end
-- Gunkan Suship Daily Special: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(s.thfilter,tp,LOCATION_DECK,0,nil)
	if #g>=3 then
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
		local sg=g:Select(tp,3,3,nil)
		if e:GetLabel()==0 and not aux.MPChooseOpponent(tp) then return end
		Duel.ConfirmCards(1-tp,sg)
		local p
		if e:GetLabel()==0 then
			p=1-tp
		elseif e:GetLabel()==1 then
			p=tp
		end
		Duel.Hint(HINT_SELECTMSG,p,HINTMSG_ATOHAND)
		local tg=sg:Select(p,1,1,nil)
		Duel.SendtoHand(tg,nil,REASON_EFFECT)
		Duel.ConfirmCards(1-tp,tg)
	end
end
