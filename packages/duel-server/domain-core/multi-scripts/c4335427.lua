-- Sophia, Goddess of Rebirth: both hands include every living duelist, including the Tag partner.
local function mp_all_remove(except)
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		g:Merge(Duel.GetMatchingGroup(s.rmfilter,p,LOCATION_HAND|LOCATION_ONFIELD|LOCATION_GRAVE,0,except))
	end)
	return g
end
function s.rmtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	local g=mp_all_remove(e:GetHandler())
	Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,#g,0,0)
	Duel.SetChainLimit(aux.FALSE)
end
function s.rmop(e,tp,eg,ep,ev,re,r,rp)
	Duel.Remove(mp_all_remove(e:GetHandler()),POS_FACEUP,REASON_EFFECT)
end
