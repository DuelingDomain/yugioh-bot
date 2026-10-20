if not Duel.MPActionSeat or not Duel.MPGeometrySeat then return end
-- The partner's Battle Phase is not this duelist's own Battle Phase.
local mp_condition=s.condition
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return Duel.MPTurnSeat()==Duel.MPSeatOf(e:GetHandler()) and mp_condition(e,tp,eg,ep,ev,re,r,rp)
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if c:IsRelateToEffect(e) then Duel.SendtoGrave(c,REASON_EFFECT) end
	-- End this turn and stop at the next Battle Phase of this exact duelist.
	Duel.SkipPhase(tp,PHASE_BATTLE,RESET_PHASE|PHASE_END,1)
	local stop=Effect.CreateEffect(c)
	stop:SetType(EFFECT_TYPE_FIELD)
	stop:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	stop:SetCode(EFFECT_CANNOT_ACTIVATE)
	stop:SetTargetRange(1,1)
	stop:SetValue(1)
	stop:SetReset(RESET_PHASE|PHASE_BATTLE|PHASE_END)
	Duel.RegisterEffect(stop,tp)
	Duel.SkipPhase(tp,PHASE_MAIN2,RESET_PHASE|PHASE_END,1)
	Duel.SkipPhase(tp,PHASE_END,RESET_PHASE|PHASE_END,1)
	local own=Duel.MPGeometrySeat()
	for seat=0,3 do
		if seat~=own and Duel.MPIsAlive(seat) then
			local skip=Effect.CreateEffect(c)
			skip:SetType(EFFECT_TYPE_FIELD)
			skip:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
			skip:SetCode(EFFECT_SKIP_TURN)
			skip:SetTargetRange(1,0)
			skip:SetReset(RESET_PHASE|PHASE_END|RESET_SELF_TURN)
			Duel.RegisterEffect(skip,Duel.MPActionSeat(seat))
		end
	end
	Duel.SkipPhase(tp,PHASE_DRAW,RESET_PHASE|PHASE_END,2)
	Duel.SkipPhase(tp,PHASE_STANDBY,RESET_PHASE|PHASE_END,2)
	Duel.SkipPhase(tp,PHASE_MAIN1,RESET_PHASE|PHASE_END,2)
	local battle=Effect.CreateEffect(c)
	battle:SetType(EFFECT_TYPE_FIELD)
	battle:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	battle:SetCode(EFFECT_CANNOT_EP)
	battle:SetTargetRange(1,0)
	battle:SetReset(RESET_PHASE|PHASE_MAIN1|RESET_SELF_TURN)
	Duel.RegisterEffect(battle,tp)
	local limit=Effect.CreateEffect(c)
	limit:SetType(EFFECT_TYPE_FIELD)
	limit:SetProperty(EFFECT_FLAG_PLAYER_TARGET|EFFECT_FLAG_OATH|EFFECT_FLAG_CLIENT_HINT)
	limit:SetDescription(aux.Stringid(id,1))
	limit:SetCode(EFFECT_CANNOT_ACTIVATE)
	limit:SetTargetRange(1,0)
	limit:SetValue(s.limit)
	limit:SetReset(RESET_PHASE|PHASE_END|RESET_SELF_TURN,2)
	Duel.RegisterEffect(limit,tp)
end
