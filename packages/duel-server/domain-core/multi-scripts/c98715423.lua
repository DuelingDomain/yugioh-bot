if not aux.MPKey then return end
-- Gravekeeper's Trap: the declared card is checked against the normal draw of the TURN PLAYER, an opponent of the holder. The stock script
-- reads the draw count, the flag and the hand of "1-tp", which folds every opponent to one value; the operation step cannot ask which one.
-- The turn player IS that opponent, so each function binds it first: Duel.MPTurnOwns(c) is true for a card that the turn player owns and then
-- binds that seat (Duel.GetFieldGroup(tp,0,LOCATION_ALL) holds cards of every opponent). It asks nothing, so the condition and the operation
-- (no pick possible) may call it. The flag (checkop, a global effect) is already written for the drawing seat, and read for the bound seat.
-- Two seats: the stock reads.
local function mp_turn_opponent(tp)
	if not Duel.MPTurnOwns or Duel.MPMode()==0 then return Duel.IsTurnPlayer(1-tp) end
	return Duel.IsTurnPlayer(1-tp) and Duel.GetFieldGroup(tp,0,LOCATION_ALL):IsExists(Duel.MPTurnOwns,1,nil)
end
function s.tgcon(e,tp,eg,ep,ev,re,r,rp)
	return mp_turn_opponent(tp) and not Duel.IsPlayerAffectedByEffect(1-tp,EFFECT_CANNOT_DRAW)
		and Duel.GetDrawCount(1-tp)>0 and Duel.GetFlagEffect(1-tp,id)==0
end
function s.tgop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not c:IsRelateToEffect(e) or not mp_turn_opponent(tp) or Duel.GetDrawCount(1-tp)<1 then return end
	--Look at the drawn card
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
	e1:SetCode(EVENT_DRAW)
	e1:SetCountLimit(1)
	e1:SetOperation(s.drawcheck)
	e1:SetLabel(e:GetLabel())
	e1:SetReset(RESET_PHASE|PHASE_DRAW)
	Duel.RegisterEffect(e1,tp)
end
function s.drawcheck(e,tp,eg,ep,ev,re,r,rp)
	if Duel.IsPhase(PHASE_DRAW) and (r&REASON_RULE)==REASON_RULE and #eg>0 then
		Duel.ConfirmCards(tp,eg)
		local dg=eg:Filter(Card.IsCode,nil,e:GetLabel())
		if #dg>0 then
			Duel.SendtoGrave(dg,REASON_EFFECT)
		end
		-- the hand of the drawing duelist (the turn player), not of "the next opponent"
		mp_turn_opponent(tp)
		Duel.ShuffleHand(1-tp)
	end
end
