if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.negop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if c:IsFaceup() and c:IsRelateToEffect(e) and c:IsAttackAbove(500) and c:IsDefenseAbove(500)
		and not c:IsStatus(STATUS_BATTLE_DESTROYED) and Duel.MPPreviousChain()==ev
		and Duel.NegateActivation(ev) then
		--This card loses exactly 500 ATK/DEF
		local e1=Effect.CreateEffect(c)
		e1:SetType(EFFECT_TYPE_SINGLE)
		e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)
		e1:SetCode(EFFECT_UPDATE_ATTACK)
		e1:SetValue(-500)
		e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)
		c:RegisterEffect(e1)
		local e2=e1:Clone()
		e2:SetCode(EFFECT_UPDATE_DEFENSE)
		c:RegisterEffect(e2)
	end
end
