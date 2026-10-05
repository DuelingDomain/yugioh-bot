if not aux.MPAny then return end
-- Chosen One: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	if Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return end
	local g1=Duel.GetMatchingGroup(s.spfilter,tp,LOCATION_HAND,0,nil,e,tp)
	local g2=Duel.GetMatchingGroup(Card.IsSpellTrap,tp,LOCATION_HAND,0,nil)
	if #g1==0 or #g2<2 then return end
	Duel.Hint(HINT_SELECTMSG,tp,aux.Stringid(id,0))
	local sg1=g1:Select(tp,1,1,nil)
	local sc=sg1:GetFirst()
	Duel.Hint(HINT_SELECTMSG,tp,aux.Stringid(id,1))
	local sg2=g2:Select(tp,2,2,nil)
	sg1:Merge(sg2)
	if not aux.MPChooseOpponent(tp) then return end
	Duel.ConfirmCards(1-tp,sg1)
	Duel.ShuffleHand(tp)
	local rg=sg1:Select(1-tp,1,1,nil)
	local tc=rg:GetFirst()
	if tc:IsCanBeSpecialSummoned(e,0,tp,false,false) then
		Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)
		Duel.SendtoGrave(sg2,REASON_EFFECT)
	else
		Duel.SendtoGrave(sg1,REASON_EFFECT)
	end
end
