if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- R-FFA-LP-COMPARE: unanimous living-opponent conditions; stock amounts/actions.
function s.drcon(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)
	local mg=g and g:GetMaxGroup(Card.GetAttack)
	return aux.MPCompareLP(tp,"<") and mg and mg:IsExists(Card.IsControler,1,nil,1-tp)
end
