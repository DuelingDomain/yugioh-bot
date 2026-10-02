-- The Law of the Normal: every living duelist discards, including the Tag partner.
local function mp_all_hands()
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		g:Merge(Duel.GetFieldGroup(p,LOCATION_HAND,0))
	end)
	return g
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	local c=e:GetHandler()
	if chk==0 then return aux.MPAllDuelists(function(p)
		return Duel.IsExistingMatchingCard(nil,p,LOCATION_HAND,0,1,c)
	end) and Duel.IsExistingMatchingCard(s.dfilter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,c) end
	local hg=mp_all_hands()
	local g=Duel.GetMatchingGroup(s.dfilter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,c)
	Duel.SetOperationInfo(0,CATEGORY_HANDES,hg,#hg,0,0)
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	Duel.SendtoGrave(mp_all_hands(),REASON_EFFECT|REASON_DISCARD)
	local g=Duel.GetMatchingGroup(s.dfilter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,nil)
	Duel.Destroy(g,REASON_EFFECT)
end
