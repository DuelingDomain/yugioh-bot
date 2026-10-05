if not aux.MPChooseOpponent then return end
-- Amaze Attraction Thrill Train: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.setop(e,tp,eg,ep,ev,re,r,rp)
	local tc=e:GetHandler():GetEquipTarget()
	if tc and tc:IsLocation(LOCATION_MZONE) and Duel.ChangePosition(tc,POS_FACEUP_DEFENSE,POS_FACEDOWN_DEFENSE,POS_FACEUP_ATTACK,POS_FACEUP_ATTACK)>0 then
		if not aux.MPChooseOpponent(tp) then return end
		Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_SET)
		local g=Duel.SelectMatchingCard(1-tp,s.setfilter,tp,LOCATION_GRAVE,0,1,1,nil)
		if #g>0 then
			Duel.SSet(tp,g)
		end
	end
end
