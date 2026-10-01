if not aux.MPKey then return end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	if Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return end
	local c=e:GetHandler()
	local tc=Duel.GetFirstTarget()
	if tc and tc:IsRelateToEffect(e) then
		local from_seat=Duel.MPSeatOf(tc)
		if Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)==0 then return end
		--Cannot be tributed
		local e1=Effect.CreateEffect(c)
		e1:SetDescription(3303)
		e1:SetProperty(EFFECT_FLAG_CLIENT_HINT)
		e1:SetType(EFFECT_TYPE_SINGLE)
		e1:SetCode(EFFECT_UNRELEASABLE_SUM)
		e1:SetReset(RESET_EVENT|RESETS_STANDARD)
		e1:SetValue(1)
		tc:RegisterEffect(e1,true)
		local e2=Effect.CreateEffect(c)
		e2:SetType(EFFECT_TYPE_SINGLE)
		e2:SetCode(EFFECT_UNRELEASABLE_NONSUM)
		e2:SetReset(RESET_EVENT|RESETS_STANDARD)
		e2:SetValue(1)
		tc:RegisterEffect(e2,true)
		--Cannot be used as synchro material
		local e3=Effect.CreateEffect(c)
		e3:SetDescription(3310)
		e3:SetProperty(EFFECT_FLAG_CLIENT_HINT)
		e3:SetType(EFFECT_TYPE_SINGLE)
		e3:SetCode(EFFECT_CANNOT_BE_SYNCHRO_MATERIAL)
		e3:SetReset(RESET_EVENT|RESETS_STANDARD)
		e3:SetValue(1)
		tc:RegisterEffect(e3,true)
		--Give control of it back to the duelist it came from
		local e4=Effect.CreateEffect(c)
		e4:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
		e4:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
		e4:SetRange(LOCATION_MZONE)
		e4:SetCode(EVENT_PHASE+PHASE_END)
		e4:SetOperation(s.ctlop)
		e4:SetReset(RESETS_STANDARD_PHASE_END)
		e4:SetCountLimit(1)
		e4:SetLabel(from_seat)
		tc:RegisterEffect(e4,true)
	end
end
function s.ctlop(e,tp,eg,ep,ev,re,r,rp)
	local tc=e:GetHandler()
	if Duel.MPBindSeat(e:GetLabel()) then
		Duel.GetControl(tc,1)
	end
	Duel.MPBindSeat()
end
