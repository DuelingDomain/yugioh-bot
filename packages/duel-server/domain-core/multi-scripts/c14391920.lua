-- Inferno Tempest: every living duelist's Deck and GY are affected, including the Tag partner.
local function mp_all_monsters()
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		g:Merge(Duel.GetMatchingGroup(s.filter,p,LOCATION_DECK|LOCATION_MZONE|LOCATION_GRAVE,0,nil))
	end)
	return g
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	local g=mp_all_monsters()
	if chk==0 then return #g>0 end
	Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,#g,0,0)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	Duel.Remove(mp_all_monsters(),POS_FACEUP,REASON_EFFECT)
end
