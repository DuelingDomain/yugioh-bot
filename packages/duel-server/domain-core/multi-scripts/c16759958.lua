if Duel.MPMode()~=1 then return end
-- R-FFA-LP-COMPARE: unanimous living-opponent conditions; stock amounts/actions.
function s.spcon(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPCompareLP(tp,">") and Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_AROMA),tp,LOCATION_MZONE,0,1,nil)
end
