if not Duel.MPActionSeat or not Duel.MPGeometrySeat then return end
function s.skop(e,tp,eg,ep,ev,re,r,rp)
	local op=Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM)
	if op==0 and Duel.IsMainPhase() then
		Duel.SkipPhase(Duel.MPActionSeat(Duel.MPTurnSeat()),Duel.GetCurrentPhase(),RESET_PHASE|PHASE_END,1)
	elseif op==1 then
		local seat=Duel.MPGeometrySeat(1-tp)
		local skip=Effect.CreateEffect(e:GetHandler())
		skip:SetDescription(aux.Stringid(id,3))
		skip:SetType(EFFECT_TYPE_FIELD)
		skip:SetProperty(EFFECT_FLAG_PLAYER_TARGET|EFFECT_FLAG_CLIENT_HINT)
		skip:SetCode(EFFECT_SKIP_M1)
		skip:SetTargetRange(1,0)
		local current=Duel.MPTurnSeat()==seat and Duel.IsPhase(PHASE_MAIN1)
		if current then
			local turn=Duel.GetTurnCount()
			skip:SetCondition(function() return Duel.GetTurnCount()~=turn end)
		end
		skip:SetReset(RESET_PHASE|PHASE_MAIN1|RESET_SELF_TURN,current and 2 or 1)
		Duel.RegisterEffect(skip,Duel.MPActionSeat(seat))
	end
end
