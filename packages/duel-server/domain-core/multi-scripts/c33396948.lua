-- One complete hand wins the whole duel. Two or more complete hands give everyone a draw.
if not aux.MPForEachDuelist then return end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local complete={}
	local count=0
	aux.MPForEachDuelist(function(p,seat)
		local g=Duel.GetFieldGroup(p,LOCATION_HAND,0)
		if not s.check(g) then return end
		complete[seat]=g
		count=count+1
	end)
	if count==0 then return end
	aux.MPForEachDuelist(function(p,seat)
		for owner,g in pairs(complete) do
			if owner~=seat then Duel.ConfirmCards(p,g) end
		end
	end)
	if count>1 then
		Duel.Win(PLAYER_NONE,WIN_REASON_EXODIA)
	else
		aux.MPForEachDuelist(function(p,seat)
			if complete[seat] then Duel.Win(p,WIN_REASON_EXODIA) return true end
		end)
	end
end
