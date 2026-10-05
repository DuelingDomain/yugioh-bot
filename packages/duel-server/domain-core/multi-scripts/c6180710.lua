if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- A living link keeps resolving after its source link is removed. Preserve independent actions.
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if c:IsRelateToEffect(e) and Duel.SpecialSummonStep(c,0,tp,tp,false,false,POS_FACEUP) then
		--Decrease DEF by 1000
		local e1=Effect.CreateEffect(c)
		e1:SetType(EFFECT_TYPE_SINGLE)
		e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
		e1:SetCode(EFFECT_UPDATE_DEFENSE)
		e1:SetReset(RESET_EVENT|RESETS_STANDARD)
		e1:SetValue(-1000)
		c:RegisterEffect(e1,true)
		--Banish it if it leaves the field
		local e2=Effect.CreateEffect(c)
		e2:SetDescription(3300)
		e2:SetType(EFFECT_TYPE_SINGLE)
		e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CLIENT_HINT)
		e2:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)
		e2:SetValue(LOCATION_REMOVED)
		e2:SetReset(RESET_EVENT|RESETS_REDIRECT)
		c:RegisterEffect(e2,true)
		--Take no damage from the activated effect
		local cid=Duel.GetChainInfo(ev,CHAININFO_CHAIN_ID)
		if cid then
			local e3=Effect.CreateEffect(c)
			e3:SetType(EFFECT_TYPE_FIELD)
			e3:SetCode(EFFECT_CHANGE_DAMAGE)
			e3:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
			e3:SetTargetRange(1,0)
			e3:SetLabel(cid)
			e3:SetValue(s.damval)
			e3:SetReset(RESET_CHAIN)
			Duel.RegisterEffect(e3,tp)
		end
	end
	Duel.SpecialSummonComplete()
end
