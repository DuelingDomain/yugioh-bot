if not aux.MPAny then return end
-- Knightmare Incarnation Idlee: the trigger asks if any one opponent controls more Link Monsters. Target chk==0 repeats the compare, so the pick comes when the trigger goes on the chain.
function s.gycon(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAny(function()
		local ct1=Duel.GetMatchingGroupCount(Card.IsType,tp,LOCATION_MZONE,0,nil,TYPE_LINK)
		local ct2=Duel.GetMatchingGroupCount(Card.IsType,tp,0,LOCATION_MZONE,nil,TYPE_LINK)
		return ct1<ct2
	end)()
end
function s.gytg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return s.gycon(e,tp,eg,ep,ev,re,r,rp) end
	local g=Duel.GetMatchingGroup(Card.IsType,tp,LOCATION_MZONE,LOCATION_MZONE,nil,TYPE_LINK)
	Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,#g,0,0)
end
