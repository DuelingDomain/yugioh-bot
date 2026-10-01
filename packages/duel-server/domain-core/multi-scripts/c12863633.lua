if not aux.MPKey then return end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if tc:IsRelateToEffect(e) then
		local e1=Effect.CreateEffect(e:GetHandler())
		e1:SetProperty(EFFECT_FLAG_ABSOLUTE_TARGET+EFFECT_FLAG_PLAYER_TARGET)
		e1:SetType(EFFECT_TYPE_FIELD)
		e1:SetCode(EFFECT_CANNOT_RELEASE)
		e1:SetRange(LOCATION_MZONE)
		e1:SetAbsoluteRange(tp,0,1)
		e1:SetTarget(s.rellimit)
		tc:RegisterEffect(e1)
		local e3=Effect.CreateEffect(e:GetHandler())
		e3:SetType(EFFECT_TYPE_SINGLE)
		e3:SetCode(EFFECT_CANNOT_BE_SYNCHRO_MATERIAL)
		e3:SetReset(RESET_EVENT|RESETS_STANDARD)
		e3:SetLabel(Duel.MPSeatOf(tc))
		e3:SetValue(s.synlimit)
		tc:RegisterEffect(e3)
	end
end
function s.synlimit(e,c)
	return c~=nil and aux.MPKeyOfSeat(Duel.MPSeatOf(c))==aux.MPKeyOfSeat(e:GetLabel())
end
