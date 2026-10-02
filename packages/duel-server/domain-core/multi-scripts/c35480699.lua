if not aux.MPForEachController then return end
-- Book of Eclipse (script fix, R1 each opponent, R-COMMON-EACH-PLAYER): "Your opponent changes all face-down monsters they control to face-up Defense
-- Position, and draws 1 card for each". The stock End Phase operation reads ONE group (every face-down monster of every opponent) and calls
-- Duel.Draw(1-tp,ct): in FFA the Lua value 1 is ONE opponent, so that one opponent drew for the monsters of all the others. Each opponent now
-- changes its OWN face-down monsters and draws 1 card for each of its own (lead decision 2026-10-01). aux.MPForEachController groups the cards by
-- real controller seat and binds the value 1 to that seat while fn runs; in Tag each opposing member is such a controller, so each member draws
-- for the monsters it controls (the team field is joined, the draw is per duelist: R-COMMON-EACH-PLAYER, the partner included). The activation
-- (all monsters of both sides are turned face-down) and the condition (some opponent has a face-down monster) are stock. Two seats: the stock script.
function s.flipop(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(Card.IsFacedown,tp,0,LOCATION_MZONE,nil)
	aux.MPForEachController(g,function(sg,seat,p)
		local ct=Duel.ChangePosition(sg,POS_FACEUP_DEFENSE)
		Duel.Draw(p,ct,REASON_EFFECT)
	end)
end
