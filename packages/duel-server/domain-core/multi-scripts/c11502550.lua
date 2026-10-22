if Duel.MPMode()~=1 then return end
-- R-FFA-LP-COMPARE: gate the bonus unanimously; retain its stock amount formula.
function s.atkval(e,c)
	if not aux.MPCompareLP(c:GetControler(),"<") then return 0 end
	local lps=Duel.GetLP(c:GetControler())
	local lpo=Duel.GetLP(1-c:GetControler())
	if lps>=lpo then return 0
	else return lpo-lps end
end
