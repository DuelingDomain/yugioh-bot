if not aux.MPForEachDuelist then return end
-- Every duelist sends 1 monster from its Extra Deck to the GY (R1, Q3, Tag partner included). The target needs every duelist to have one.
function s.tgtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.IsExistingMatchingCard(Card.IsAbleToGrave,tp_i,LOCATION_EXTRA,0,1,nil) end) end
	Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,2,PLAYER_ALL,LOCATION_EXTRA)
end
function s.tgop(e,tp,eg,ep,ev,re,r,rp)
	local sg=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i)
		Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_TOGRAVE)
		local sc=Duel.SelectMatchingCard(tp_i,Card.IsAbleToGrave,tp_i,LOCATION_EXTRA,0,1,1,nil):GetFirst()
		if sc then sg:AddCard(sc) end
	end)
	if #sg>0 then
		Duel.SendtoGrave(sg,REASON_EFFECT)
	end
end
