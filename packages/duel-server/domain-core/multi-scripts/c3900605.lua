if not aux.MPKey then return end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(s.filter,tp,LOCATION_SZONE,LOCATION_SZONE,nil)
	Duel.Destroy(g,REASON_EFFECT)
	local dg=Duel.GetOperatedGroup()
	Duel.BreakEffect()
	-- Each living duelist draws for its own destroyed cards. The loop names the duelist (a Tag partner too: aux.MPForEachController runs
	-- the partner without a bind, so its draw would go to the duelist that runs the effect).
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local ct=dg:FilterCount(function(c) return Duel.MPSeatOf(c)==seat_i end,nil)
		if ct~=0 then Duel.Draw(tp_i,ct,REASON_EFFECT) end
	end)
	--cannot set
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetType(EFFECT_TYPE_FIELD)
	e1:SetCode(EFFECT_CANNOT_MSET)
	e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	e1:SetTargetRange(1,0)
	e1:SetTarget(aux.TRUE)
	e1:SetReset(RESET_PHASE|PHASE_END)
	Duel.RegisterEffect(e1,tp)
	local e2=e1:Clone()
	e2:SetCode(EFFECT_CANNOT_SSET)
	Duel.RegisterEffect(e2,tp)
	local e3=e1:Clone()
	e3:SetCode(EFFECT_CANNOT_TURN_SET)
	Duel.RegisterEffect(e3,tp)
	local e4=e1:Clone()
	e4:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
	e4:SetTarget(s.sumlimit)
	Duel.RegisterEffect(e4,tp)
end
