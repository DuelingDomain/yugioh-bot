if Duel.MPMode()~=1 then return end
-- Same lower-first/equality rule as Unstable Evolution (R-FFA-LP-COMPARE).
function s.condition(e)
	return not aux.MPCompareLP(e:GetHandlerPlayer(),"==")
end
function s.value(e,c)
	if aux.MPCompareLP(e:GetHandlerPlayer(),"<") then return c:GetBaseAttack()*2 end
	return c:GetBaseAttack()/2
end
