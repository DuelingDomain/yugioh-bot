if not aux.MPChooseOpponent then return end
-- Earthshaker: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local sg=Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)
	if #sg==0 then return false end
	local tc=sg:GetFirst()
	local att=0
	for tc in aux.Next(sg) do
		att=(att|tc:GetAttribute())
	end
	if (att&att-1)==0 then return end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATTRIBUTE)
	local att1=Duel.AnnounceAttribute(tp,2,att)
	if not aux.MPChooseOpponent(tp) then return end
	Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_ATTRIBUTE)
	local att2=Duel.AnnounceAttribute(1-tp,1,att1)
	local g=Duel.GetMatchingGroup(s.desfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil,att2)
	Duel.Destroy(g,REASON_EFFECT)
end
