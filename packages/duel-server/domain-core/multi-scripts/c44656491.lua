if not aux.MPAny then return end
-- Messenger of Peace (script fix, late-cards): the 100 LP is asked only in the Standby Phase of the duelist that owns the card.
-- The stock condition is Duel.IsTurnPlayer(tp). In Tag the Lua value tp is the team, so it was true in the Standby Phase of the partner
-- too, and the owner was asked to pay at a turn that is not its own. ADR-0002 (card decisions): in Tag only the Standby Phase of the own
-- duelist turn counts, and the team LP pays (the operation is the stock one: CheckLPCost and PayLPCost on tp read the team total).
-- Duel.MPTurnOwns(c) is the seat compare (the turn player is the real owner of c, alive). FFA: the same as IsTurnPlayer(tp).
function s.mtcon(e,tp,eg,ep,ev,re,r,rp)
	return Duel.MPTurnOwns(e:GetHandler())
end
