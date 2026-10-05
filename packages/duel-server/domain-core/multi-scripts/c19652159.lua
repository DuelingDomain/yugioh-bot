if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.negop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not (c:IsRelateToEffect(e) and c:IsFaceup() and c:IsAttackAbove(1000) and c:IsDefenseAbove(1000)
		and not c:IsStatus(STATUS_BATTLE_DESTROYED)) then return end
	local prev_atk,prev_def=c:GetAttack(),c:GetDefense()
	--This card loses 1000 ATK/DEF
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_SINGLE)
	e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)
	e1:SetCode(EFFECT_UPDATE_ATTACK)
	e1:SetValue(-1000)
	e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)
	c:RegisterEffect(e1)
	local e2=e1:Clone()
	e2:SetCode(EFFECT_UPDATE_DEFENSE)
	c:RegisterEffect(e2)
	if c:IsAttack(prev_atk-1000) and c:IsDefense(prev_def-1000) and Duel.MPPreviousChain()==ev then
		Duel.NegateActivation(ev)
	end
end
