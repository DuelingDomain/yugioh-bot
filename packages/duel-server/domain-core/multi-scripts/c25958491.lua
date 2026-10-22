if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- R-FFA-LP-COMPARE (owner 2026-10-22): choose the sign with the lower-first
-- rule; retain the existing LP difference magnitude and opponent scope.
function s.atkval(e,c)
	local cont=c:GetControler()
	if aux.MPCompareLP(cont,"==") then return 0 end
	local difference=math.abs(Duel.GetLP(cont)-Duel.GetLP(1-cont))
	if aux.MPCompareLP(cont,"<") then return -difference end
	return difference
end
