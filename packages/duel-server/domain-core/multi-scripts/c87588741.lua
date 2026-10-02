if not aux.MPAny then return end
-- Qliphort Cephalopod: the compare is in the trigger target. chk==0 asks if any one opponent has more monsters in the
-- Graveyard than you. The target and the operation read the count on the bound opponent.
function s.damtg(e,tp,eg,ep,ev,re,r,rp,chk)
	local ct1=Duel.GetMatchingGroupCount(Card.IsMonster,tp,LOCATION_GRAVE,0,nil)
	if chk==0 then return aux.MPAny(function() return Duel.GetMatchingGroupCount(Card.IsMonster,tp,0,LOCATION_GRAVE,nil)>ct1 end)() end
	local ct=aux.MPValue(function() return Duel.GetMatchingGroupCount(Card.IsMonster,tp,0,LOCATION_GRAVE,nil) end)()-ct1
	Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,ct*300)
	Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,ct*300)
end
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local ct1=Duel.GetMatchingGroupCount(Card.IsMonster,tp,LOCATION_GRAVE,0,nil)
	local ct=aux.MPValue(function() return Duel.GetMatchingGroupCount(Card.IsMonster,tp,0,LOCATION_GRAVE,nil) end)()-ct1
	if ct>0 then
		local val=Duel.Recover(tp,ct*300,REASON_EFFECT)
		Duel.Damage(1-tp,val,REASON_EFFECT)
	end
end
