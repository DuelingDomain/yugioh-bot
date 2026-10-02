if not aux.MPForEachController then return end
-- Prediction Princess Astromorrigan (script fix, R1 each opponent, R-COMMON-EACH-PLAYER): "During the End Phase of this turn, destroy all Defense
-- Position monsters your opponent controls, and if you do, your opponent takes 500 damage for each monster destroyed this way". The stock End Phase
-- operation (registered with Duel.RegisterEffect, so it has no bound opponent) reads ONE group (the Defense Position monsters of EVERY opponent)
-- and calls Duel.Damage(1-tp,ct*500): in FFA the Lua value 1 is ONE opponent, so that one opponent took the damage for the monsters of all the
-- others. Each opponent now takes 500 damage for each of its OWN monsters that this effect destroyed (lead decision 2026-10-01, as Book of
-- Eclipse). aux.MPForEachController groups the cards by real controller seat and binds the value 1 to that seat while fn runs. In Tag the
-- opposing members are the same team (one LP pool), so the sum of the damage is the stock value. Two seats: the stock script.
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(s.desfilter,tp,0,LOCATION_MZONE,nil)
	if #g>0 then
		Duel.Hint(HINT_CARD,0,id)
		aux.MPForEachController(g,function(sg,seat,p)
			local ct=Duel.Destroy(sg,REASON_EFFECT)
			Duel.Damage(p,ct*500,REASON_EFFECT)
		end)
	end
end
