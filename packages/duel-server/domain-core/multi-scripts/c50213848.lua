if not aux.MPAny then return end
-- Monster Reborn Reborn: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetTargetCards(e)
	if #g==0 or Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return end
	if not aux.MPChooseOpponent(tp) then return end
	Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_SPSUMMON)
	local sg=g:FilterSelect(1-tp,s.filter,1,1,nil,e,tp)
	if #sg>0 and Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)>0 then
		Duel.Remove(g-sg,POS_FACEUP,REASON_EFFECT)
	end
end
