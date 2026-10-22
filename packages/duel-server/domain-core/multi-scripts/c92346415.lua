if Duel.MPMode()~=1 then return end
-- R-FFA-LP-COMPARE: gate the bonus unanimously; retain its stock amount formula.
function s.atkval(e,c)
	if not aux.MPCompareLP(e:GetHandlerPlayer(),"<") then return 0 end
	local dif=Duel.GetLP(1-e:GetHandlerPlayer())-Duel.GetLP(e:GetHandlerPlayer())
	if dif>0 then
		return dif>2000 and 2000 or dif
	else return 0 end
end
