if not aux.MPForEachController then return end
-- The summoned monster fixes the return field. The custom event must not ask for another seat.
function s.ctrlfilter(c,tp)
	local ok=false
	aux.MPForEachController(Group.FromCards(c),function(g,seat,p)
		ok=Duel.GetLocationCount(p,LOCATION_MZONE,tp,LOCATION_REASON_CONTROL)>0
	end)
	return ok
end
local mp_ctrlop=s.ctrlop
function s.ctrlop(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if not tc then return end
	aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
		mp_ctrlop(e,tp,eg,ep,ev,re,r,rp)
	end)
end
