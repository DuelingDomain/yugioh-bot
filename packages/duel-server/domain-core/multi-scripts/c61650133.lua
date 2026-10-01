if not aux.MPAny then return end
-- Summoning Curse: "the current controller of that monster(s) banishes 1 card from their hand" for every controller, also at 3 or 4 seats.
-- The stock effect reads the controller of a summoned monster as the Lua value 0 or 1. That value folds every opponent to 1, so two opponents
-- that Special Summon in the same event (a monster of p1 and a monster of p2) were ONE controller and only one of them banished a card.
-- aux.MPForEachController runs the loop once for every real controller seat of the summoned monsters, in seat order. For an opponent
-- it binds the Lua value 1 to that seat (Duel.MPBindSeat), so the pick and the banish reach that duelist and not "the next opponent".
-- A controller that is gone (eliminated) is skipped by the helper (Q9).
function s.rmop(e,tp,eg,ep,ev,re,r,rp)
	local g=Group.CreateGroup()
	aux.MPForEachController(eg:Filter(Card.IsOnField,nil),function(sg,seat,p)
		Duel.Hint(HINT_SELECTMSG,p,HINTMSG_REMOVE)
		g:Merge(Duel.SelectMatchingCard(p,Card.IsAbleToRemove,p,LOCATION_HAND,0,1,1,nil))
	end)
	Duel.Remove(g,POS_FACEUP,REASON_EFFECT)
end
