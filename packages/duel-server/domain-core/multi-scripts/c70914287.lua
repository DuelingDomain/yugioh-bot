if not aux.MPAny then return end
-- Kuribabylon: the ignition condition asks if any one opponent has fewer monsters in the Graveyard than you.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAny(function() return Duel.GetMatchingGroupCount(Card.IsMonster,tp,LOCATION_GRAVE,0,nil)>Duel.GetMatchingGroupCount(Card.IsMonster,1-tp,LOCATION_GRAVE,0,nil) end)()
end
