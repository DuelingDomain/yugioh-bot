if not Duel.MPActionSeat or not Duel.MPGeometrySeat then return end
s.target=aux.MPTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		if Duel.MPBound() then return not Duel.IsPlayerAffectedByEffect(1-tp,EFFECT_SKIP_TURN) end
		return aux.MPAnyOpponent(tp,function(p)
			return not Duel.IsPlayerAffectedByEffect(p,EFFECT_SKIP_TURN)
		end)
	end
end)
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local seat=Duel.MPGeometrySeat(1-tp)
	local skip=Effect.CreateEffect(e:GetHandler())
	skip:SetType(EFFECT_TYPE_FIELD)
	skip:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	skip:SetCode(EFFECT_SKIP_TURN)
	skip:SetTargetRange(1,0)
	-- During the chosen duelist's turn, its current End Phase also counts.
	skip:SetReset(RESET_PHASE|PHASE_END|RESET_SELF_TURN,Duel.MPTurnSeat()==seat and 2 or 1)
	Duel.RegisterEffect(skip,Duel.MPActionSeat(seat))
end
