if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- R-FFA-LP-COMPARE: unanimous living-opponent conditions; stock amounts/actions.
function s.dmgcond(e)
	local tp=e:GetHandlerPlayer()
	return aux.MPCompareLP(tp,">") and Duel.GetAttacker()==e:GetHandler()
end
