if not Duel.MPActionSeat or not Duel.MPGeometrySeat then return end
-- Heads can activate only during this controller's own End Phase.
local mp_skipcon=s.skipcon
function s.skipcon(e,tp,eg,ep,ev,re,r,rp)
	return Duel.MPTurnSeat()==Duel.MPSeatOf(e:GetHandler()) and mp_skipcon(e,tp,eg,ep,ev,re,r,rp)
end
s.skiptg=aux.MPTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		if Duel.MPBound() then return not Duel.IsPlayerAffectedByEffect(1-tp,EFFECT_SKIP_TURN) end
		return aux.MPAnyOpponent(tp,function(p)
			return not Duel.IsPlayerAffectedByEffect(p,EFFECT_SKIP_TURN)
		end)
	end
end)
function s.skipop(e,tp,eg,ep,ev,re,r,rp)
	local seat=Duel.MPGeometrySeat(1-tp)
	local skip=Effect.CreateEffect(e:GetHandler())
	skip:SetType(EFFECT_TYPE_FIELD)
	skip:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	skip:SetCode(EFFECT_SKIP_TURN)
	skip:SetTargetRange(1,0)
	skip:SetReset(RESET_PHASE|PHASE_END|RESET_SELF_TURN)
	Duel.RegisterEffect(skip,Duel.MPActionSeat(seat))
end
-- Tag joins opposing GYs. Find the top card by its exact controller and sequence.
local function mp_top_grave(tp)
	local seat=Duel.MPGeometrySeat(1-tp)
	local top=nil
	for card in aux.Next(Duel.GetFieldGroup(tp,0,LOCATION_GRAVE)) do
		if Duel.MPSeatOf(card)==seat and (not top or card:GetSequence()>top:GetSequence()) then top=card end
	end
	return top
end
s.thtg=aux.MPTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	local tc=mp_top_grave(tp)
	if tc then Duel.SetOperationInfo(0,CATEGORY_TOHAND,tc,1,0,0) end
end)
function s.thop(e,tp,eg,ep,ev,re,r,rp)
	local tc=mp_top_grave(tp)
	if tc then
		Duel.SendtoHand(tc,nil,REASON_EFFECT)
		Duel.ConfirmCards(tp,tc)
	end
end
