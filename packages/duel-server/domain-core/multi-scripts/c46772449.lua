if not aux.MPAny then return end
-- Evilswarm Exciton Knight: the quick effect condition asks if any one opponent has more cards in the hand and on the field.
-- Own Main Phase: any one opponent counts and the pick binds that opponent (rulebook, Frequently Asked Cards).
-- Opponent's Battle Phase: you must choose that opponent (the turn player), so only the turn player counts. A richer bystander
-- cannot make it legal, and the turn player is the one opponent that passes, so the chain link binds the turn player with no pick (#214).
-- Inside aux.MPAny, Duel.MPSeat(1-tp) is the opponent that the check sees (FFA: tp is 0 there, so its seat; Tag: the opposing team of tp).
function s.descon(e,tp,eg,ep,ev,re,r,rp)
	if not ((Duel.IsTurnPlayer(tp) and Duel.IsMainPhase()) or (Duel.IsTurnPlayer(1-tp) and Duel.IsBattlePhase())) then return false end
	local turn_only=Duel.IsTurnPlayer(1-tp)
	local turn_key=Duel.MPMode()~=0 and aux.MPKeyOfSeat(Duel.MPTurnSeat())
	return aux.MPAny(function()
		if turn_only and Duel.MPMode()~=0 and Duel.MPSeat(1-tp)~=turn_key then return false end
		return Duel.GetFieldGroupCount(tp,0,LOCATION_HAND|LOCATION_ONFIELD)>Duel.GetFieldGroupCount(tp,LOCATION_HAND|LOCATION_ONFIELD,0)
	end)()
end
