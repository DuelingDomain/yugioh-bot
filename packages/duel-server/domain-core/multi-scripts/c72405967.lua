if not aux.MPForEachDuelist then return end
-- Royal Tribute (script fix, late-cards): "each player discards all Monster Cards in their hand" has no opponent pick.
-- The stock target and operation read the hand of "1" (the opponent). At 3 or 4 seats the value 1 is any opponent, so the
-- controller was asked to pick one and only that opponent's hand was read. Rule R-COMMON-EACH-PLAYER: every living duelist
-- discards the Monsters of its own hand, the Tag partner too. Each duelist is read in its own scope, so nothing is bound.
function s.handestg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		return aux.MPAnyDuelist(function(tp_i)
			return Duel.IsExistingMatchingCard(nil,tp_i,LOCATION_HAND,0,1,e:GetHandler())
		end)
	end
	Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,PLAYER_ALL,0)
	Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,PLAYER_ALL,LOCATION_HAND)
end
function s.handesop(e,tp,eg,ep,ev,re,r,rp)
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i)
		g:Merge(Duel.GetMatchingGroup(Card.IsMonster,tp_i,LOCATION_HAND,0,nil))
	end)
	if #g>0 then
		Duel.SendtoGrave(g,REASON_EFFECT|REASON_DISCARD)
	end
end
