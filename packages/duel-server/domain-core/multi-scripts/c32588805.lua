if not aux.MPAny then return end
-- The Despair Uranus: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.setop(e,tp,eg,ep,ev,re,r,rp)
	if Duel.GetLocationCount(tp,LOCATION_SZONE)<=0 then return end
	if not aux.MPChooseOpponent(tp) then return end
	local op=Duel.SelectOption(1-tp,aux.Stringid(id,1),aux.Stringid(id,2))
	local g=Duel.GetMatchingGroup(s.setfilter,tp,LOCATION_DECK,0,nil)
	if #g==0 then return end
	local filter=op==0 and Card.IsContinuousSpell or Card.IsContinuousTrap
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SET)
	local sg=g:FilterSelect(tp,filter,1,1,nil)
	if #sg>0 then
		Duel.SSet(tp,sg)
	end
end
