if not aux.MPAny then return end
-- Gigantic Thundercross: the count of banished cards is read on the bound opponent (target). The operation lets that opponent Special Summon from their
-- Deck after the banish (1-tp): it runs bound to the same opponent (MPOne), so Tag has a bound opponent there too.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return chkc:IsLocation(LOCATION_MZONE|LOCATION_GRAVE) and s.filter(chkc) end
	local ct=aux.MPValue(function() return math.abs(Duel.GetFieldGroupCount(tp,LOCATION_REMOVED,0)-Duel.GetFieldGroupCount(tp,0,LOCATION_REMOVED)) end)()
	if chk==0 then return ct>0 and Duel.IsExistingTarget(s.filter,tp,LOCATION_MZONE|LOCATION_GRAVE,LOCATION_MZONE|LOCATION_GRAVE,ct,nil) end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_REMOVE)
	local g=Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE|LOCATION_GRAVE,LOCATION_MZONE|LOCATION_GRAVE,ct,ct,nil)
	Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,1,0,0)
	Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,1-tp,LOCATION_DECK)
end
-- FFA: the count reads the bound opponent (MPValue asks for the pick). Tag: the count reads the joined side and asks nothing, so the target picks the
-- opposing duelist (MPTarget) that the operation uses.
local ffa_target=s.target
local tag_target=aux.MPTarget(ffa_target)
function s.target(...)
	if Duel.MPMode()==2 then return tag_target(...) end
	return ffa_target(...)
end
s.activate=aux.MPOne(s.activate)
