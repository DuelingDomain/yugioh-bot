if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- R-FFA-LP-COMPARE: unanimous living-opponent conditions; stock amounts/actions.
function s.spcon(e,tp,eg,ep,ev,re,r,rp)
	return Duel.IsTurnPlayer(1-tp) and aux.MPCompareLP(tp,"<")
end
