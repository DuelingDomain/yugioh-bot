if not aux.MPForEachDuelist then return end
-- Every duelist with fewer than 2 Spells and Traps on its field takes damage (R1, Q3, Tag partner included; the LP is the team LP in Tag).
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	if not e:GetHandler():IsRelateToEffect(e) then return end
	aux.MPForEachDuelist(function(tp_i)
		local ct=Duel.GetMatchingGroupCount(Card.IsSpellTrap,tp_i,LOCATION_ONFIELD,0,nil)
		if ct<2 then
			Duel.Damage(tp_i,1000-ct*500,REASON_EFFECT)
		end
	end)
end
