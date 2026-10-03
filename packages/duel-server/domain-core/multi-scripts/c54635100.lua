-- Linkerbell checks each eligible opponent before a Link Summon.
local mp_cost=s.spcost
function s.spcost(e,c,tp,st)
	if (st&SUMMON_TYPE_LINK)~=SUMMON_TYPE_LINK then return true end
	if Duel.MPMode()==2 and not Duel.MPBound() then
		local own=Duel.GetFieldGroupCount(tp,LOCATION_EXTRA,0)
		return aux.MPAnyOpponent(tp,function(p) return own-Duel.GetFieldGroupCount(p,LOCATION_EXTRA,0)>=3 end)
	end
	return aux.MPAny(function() return mp_cost(e,c,tp,st) end)()
end
