if not aux.MPChooseOpponent then return end
-- Question: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(s.filter,tp,LOCATION_GRAVE,0,nil)
	if #g==0 then return end
	local last=g:GetFirst()
	local tc=g:GetNext()
	for tc in aux.Next(g) do
		if tc:GetSequence()<last:GetSequence() then last=tc end
	end
	if not aux.MPChooseOpponent(tp) then return end
	Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_CODE)
	local ac=Duel.AnnounceCard(1-tp,TYPE_MONSTER)
	if ac~=last:GetCode() then
		Duel.SpecialSummon(last,0,tp,tp,false,false,POS_FACEUP)
	else
		Duel.Remove(last,POS_FACEUP,REASON_EFFECT)
	end
end
