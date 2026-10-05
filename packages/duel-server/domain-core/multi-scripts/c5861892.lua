if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.negop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not c:IsFaceup() or c:GetAttack()<1000 or not c:IsRelateToEffect(e) or Duel.MPPreviousChain()~=ev then
		return
	end
	if Duel.NegateActivation(ev) then
		if re:GetHandler():IsRelateToEffect(re) then
			Duel.Destroy(re:GetHandler(),REASON_EFFECT)
		end
		local e1=Effect.CreateEffect(c)
		e1:SetType(EFFECT_TYPE_SINGLE)
		e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)
		e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)
		e1:SetCode(EFFECT_UPDATE_ATTACK)
		e1:SetValue(-1000)
		c:RegisterEffect(e1)
	end
end
