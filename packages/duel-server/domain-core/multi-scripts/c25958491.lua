if Duel.MPMode()~=1 then return end
-- R-FFA-LP-COMPARE: unanimous living-opponent conditions; stock amounts/actions.
function s.atkval(e,c)
	local cont=c:GetControler()
	if not (aux.MPCompareLP(cont,"<") or aux.MPCompareLP(cont,">")) then return 0 end
	return Duel.GetLP(cont)-Duel.GetLP(1-cont)
end
