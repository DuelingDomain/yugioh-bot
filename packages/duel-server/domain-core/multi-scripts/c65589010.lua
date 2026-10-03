if not aux.MPForEachDuelist then return end
-- Every duelist sends 1 card from its Extra Deck to the GY (R1, Q3, Tag partner included). The target needs every duelist to have one.
function s.gytg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.GetFieldGroupCount(tp_i,LOCATION_EXTRA,0)>0 end) end
	Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,2,PLAYER_ALL,LOCATION_EXTRA)
end
function s.gyop(e,tp,eg,ep,ev,re,r,rp)
	local sg=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i)
		Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_TOGRAVE)
		local g=Duel.SelectMatchingCard(tp_i,Card.IsAbleToGrave,tp_i,LOCATION_EXTRA,0,1,1,nil)
		if #g>0 then sg:AddCard(g:GetFirst()) end
	end)
	if #sg>0 then
		Duel.SendtoGrave(sg,REASON_EFFECT)
	end
end
