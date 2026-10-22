if Duel.MPMode()~=1 then return end
-- R-FFA-LP-COMPARE: unanimous living-opponent conditions; stock amounts/actions.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPCompareLP(tp,"<=",2000)
end
