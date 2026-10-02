if not Duel.MPSeatOf or not Duel.MPBindSeat then return end
-- Keep the real battle controllers before the destroyed cards go back to their owners.
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local tc=e:GetLabelObject()
	local bc=tc:GetBattleTarget()
	if tc:IsRelateToBattle() and not tc:IsImmuneToEffect(e)
		and tc:IsControler(tp) and not bc:IsControler(tp) then
		local e1=Effect.CreateEffect(e:GetHandler())
		e1:SetType(EFFECT_TYPE_SINGLE)
		e1:SetCode(EFFECT_SET_ATTACK_FINAL)
		e1:SetValue(bc:GetAttack())
		e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_DAMAGE_CAL)
		tc:RegisterEffect(e1)
		local e2=Effect.CreateEffect(e:GetHandler())
		e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
		e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
		e2:SetCode(EVENT_DAMAGE_STEP_END)
		e2:SetLabelObject({[tc]=Duel.MPSeatOf(tc),[bc]=Duel.MPSeatOf(bc)})
		e2:SetOperation(s.damop)
		e2:SetReset(RESET_PHASE|PHASE_DAMAGE)
		Duel.RegisterEffect(e2,tp)
	end
end
function s.damage(c,tp,seats)
	if not c or c:GetReason()&0x21~=0x21 then return end
	local seat=seats[c]
	if seat==nil then return end
	local own=aux.MPKey(tp)
	local key=aux.MPKeyOfSeat(seat)
	if Duel.MPMode()==2 then
		Duel.Damage(key,c:GetBaseAttack(),REASON_EFFECT)
	elseif key==own then
		Duel.Damage(0,c:GetBaseAttack(),REASON_EFFECT)
	elseif Duel.MPBindSeat(seat) then
		Duel.Damage(1,c:GetBaseAttack(),REASON_EFFECT)
	end
	Duel.MPBindSeat()
end
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local seats=e:GetLabelObject()
	s.damage(Duel.GetAttacker(),tp,seats)
	s.damage(Duel.GetAttackTarget(),tp,seats)
end
