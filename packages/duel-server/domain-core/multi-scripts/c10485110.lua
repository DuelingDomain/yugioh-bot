-- Ocean Dragon Lord - Neo-Daedalus: both hands include every living duelist, including the Tag partner.
local function mp_all_grave(except)
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		g:Merge(Duel.GetMatchingGroup(Card.IsAbleToGrave,p,LOCATION_HAND|LOCATION_ONFIELD,0,except))
	end)
	return g
end
function s.tgcostfilter(c,hc)
	return c:IsCode(CARD_UMI) and c:IsFaceup() and c:IsAbleToGraveAsCost()
		and #mp_all_grave(Group.FromCards(c,hc))>0
end
function s.tgtg(e,tp,eg,ep,ev,re,r,rp,chk)
	local g=mp_all_grave(e:GetHandler())
	if chk==0 then return #g>0 end
	Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,#g,0,0)
end
function s.tgop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	local g=mp_all_grave(c:IsRelateToEffect(e) and c or nil)
	if #g>0 then Duel.SendtoGrave(g,REASON_EFFECT) end
end
