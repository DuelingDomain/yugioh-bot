if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- R-FFA-LP-COMPARE: unanimous living-opponent conditions; stock amounts/actions.
function s.spcon(e,c)
	if c==nil then return true end
	local tp=c:GetControler()
	return aux.MPCompareLP(tp,"<=",2000)
		and Duel.GetLocationCount(tp,LOCATION_MZONE)>0
end
