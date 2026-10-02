if not aux.MPForEachDuelist then return end
-- Return all monsters to the hand; every duelist takes 300 damage for each of its own cards that went to its hand (R1, Q3, Tag partner
-- included). The cards are grouped by their real controller (aux.MPForEachController): the opponent seat is bound while its damage is dealt.
function s.retop(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(Card.IsAbleToHand,tp,LOCATION_MZONE,LOCATION_MZONE,nil)
	if #g==0 then return end
	Duel.SendtoHand(g,nil,REASON_EFFECT)
	aux.MPForEachController(g,function(sg,seat,p)
		local ct=sg:FilterCount(Card.IsLocation,nil,LOCATION_HAND)
		if ct>0 then Duel.Damage(p,ct*300,REASON_EFFECT,true) end
	end)
	Duel.RDComplete()
end
