if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- Owner ruling 2026-10-23: this difference belongs to the opponent in the battle.
function s.mpbattlelp(tp)
	local target=Duel.GetAttackTarget()
	local seat=target and Duel.MPSeatOf(target) or Duel.MPAttackedSeat()
	local other=seat and Duel.MPGetLP(seat)
	if other~=nil then return other,seat end
	local fallback,lp=aux.MPHighestLPOpponent(aux.MPKey(tp))
	return lp,fallback
end
function s.atkcon(e,tp,eg,ep,ev,re,r,rp)
	local a=Duel.GetAttacker()
	local d=Duel.GetAttackTarget()
	return a and d and a:IsControler(tp) and a:GetAttack()<d:GetAttack() and Duel.GetLP(tp)~=s.mpbattlelp(tp)
end
function s.atkop(e,tp,eg,ep,ev,re,r,rp)
	local c=Duel.GetAttacker()
	if c:IsFaceup() and c:IsRelateToBattle() then
		local lp,seat=s.mpbattlelp(tp)
		aux.MPLPOpponentHint(e:GetHandler(),seat)
		local e1=Effect.CreateEffect(e:GetHandler())
		e1:SetType(EFFECT_TYPE_SINGLE)
		e1:SetCode(EFFECT_UPDATE_ATTACK)
		e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_DAMAGE_CAL)
		e1:SetValue(math.abs(Duel.GetLP(tp)-lp))
		c:RegisterEffect(e1)
	end
end
