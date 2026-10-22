if Duel.MPMode()~=1 then return end
-- R-FFA-LP-COMPARE: unanimous living-opponent conditions; stock amounts/actions.
function s.damtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPCompareLP(tp,">")
		and (Duel.IsExistingMatchingCard(s.envfilter,tp,LOCATION_ONFIELD,0,1,nil) or Duel.IsEnvironment(CARD_SANCTUARY_SKY,tp)) end
	Duel.SetTargetPlayer(1-tp)
	Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,0)
end
