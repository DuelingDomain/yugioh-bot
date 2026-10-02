local function mp_count_condition(e,tp)
	local own=Duel.GetFieldGroupCount(tp,LOCATION_HAND,0)
	if Duel.MPMode()~=2 then
		return aux.MPAny(function() return own>Duel.GetFieldGroupCount(tp,0,LOCATION_HAND) end)()
	end
	local me,total=aux.MPKey(tp),0
	aux.MPForEachDuelist(function(p,seat)
		if aux.MPKeyOfSeat(seat)~=me then total=total+Duel.GetFieldGroupCount(p,LOCATION_HAND,0) end
	end)
	return own>total
end
local mp_initial=s.initial_effect
function s.initial_effect(c)
	local reg=Card.RegisterEffect
	Card.RegisterEffect=function(card,e,...)
		if card==c and e:GetDescription()==aux.Stringid(id,1) then e:SetCondition(mp_count_condition) end
		return reg(card,e,...)
	end
	local ok,err=pcall(mp_initial,c)
	Card.RegisterEffect=reg
	if not ok then error(err,0) end
end
