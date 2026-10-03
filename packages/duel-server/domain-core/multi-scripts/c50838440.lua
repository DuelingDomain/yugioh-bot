if not aux.MPAny then return end
-- Three in One: the activation condition asks if any one opponent has more cards in the hand and on the field, in the End Phase of THAT
-- opponent's turn. FFA: the window of an opponent passes only when that opponent is the turn player (IsTurnPlayer(1-tp) folds every opponent to
-- true), so an opponent with more cards that is not the turn player does not count. Duel.MPTurnOwns(c) is the seat compare with the turn player.
local function turn_opponent(tp)
	if Duel.MPMode and Duel.MPMode()==1 then
		return Duel.GetFieldGroup(tp,0,LOCATION_ALL):IsExists(Duel.MPTurnOwns,1,nil)
	end
	return Duel.IsTurnPlayer(1-tp)
end
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return Duel.IsPhase(PHASE_END)
		and aux.MPAny(function() return turn_opponent(tp) and Duel.GetFieldGroupCount(1-tp,LOCATION_HAND|LOCATION_ONFIELD,0)>Duel.GetFieldGroupCount(tp,LOCATION_HAND|LOCATION_ONFIELD,0) end)()
end
