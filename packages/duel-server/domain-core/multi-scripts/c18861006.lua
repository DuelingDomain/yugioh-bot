if not aux.MPAny then return end
-- Crimson Firewing Pegasus: the compare asks if any one opponent passes (MPAny). Nothing else changes.
s.spcon=aux.MPAny(s.spcon)

if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.damtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,Duel.MPChainCount()*300)
end
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if Duel.Damage(1-tp,Duel.MPChainCount()*300,REASON_EFFECT)>0 and c:IsRelateToEffect(e) then
		--This card cannot be destroyed by card effects activated before this effect in this Chain
		local e1=Effect.CreateEffect(c)
		e1:SetDescription(3008)
		e1:SetType(EFFECT_TYPE_SINGLE)
		e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CLIENT_HINT)
		e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)
		e1:SetValue(function(e,re,rp) return re:IsActivated() end)
		e1:SetReset(RESETS_STANDARD_PHASE_END|RESET_CHAIN)
		c:RegisterEffect(e1)
	end
end
