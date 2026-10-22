if Duel.MPMode()~=1 then return end
-- R-FFA-LP-COMPARE: unanimous living-opponent conditions; stock amounts/actions.
function s.adcon(e)
	local tp=e:GetHandlerPlayer()
	return aux.MPCompareLP(tp,">")
end
