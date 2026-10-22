if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- Lower-first Equip Spell: equality with everyone is neutral; otherwise the
-- reduced branch is the fallback when the controller is not lower than ALL.
function s.condition(e)
	return not aux.MPCompareLP(e:GetHandlerPlayer(),"==")
end
function s.value(e,c)
	if aux.MPCompareLP(e:GetHandlerPlayer(),"<") then return 2400 end
	return 1000
end
