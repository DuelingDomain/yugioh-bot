if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.linkop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	local e1=nil
	if c:IsRelateToEffect(e) then
		--If this card you control would be used as material for that Link Summon, you can also use 1 Link-2 or lower monster your opponent controls
		e1=Effect.CreateEffect(c)
		e1:SetType(EFFECT_TYPE_FIELD)
		e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CANNOT_DISABLE)
		e1:SetCode(EFFECT_EXTRA_MATERIAL)
		e1:SetRange(LOCATION_MZONE)
		e1:SetTargetRange(1,0)
		e1:SetOperation(s.extracon)
		e1:SetValue(s.extraval)
		e1:SetReset(RESET_EVENT|RESETS_STANDARD)
		c:RegisterEffect(e1)
	end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
	local sc=Duel.SelectMatchingCard(tp,Card.IsLinkSummonable,tp,LOCATION_EXTRA,0,1,1,nil):GetFirst()
	if sc then
		Duel.LinkSummon(tp,sc)
		if e1 then
			local eff_code=Duel.MPChainCount()==1 and EVENT_SPSUMMON or EVENT_SPSUMMON_SUCCESS
			--Reset e1
			local e2=Effect.CreateEffect(c)
			e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
			e2:SetCode(eff_code)
			e2:SetOperation(function(e) e1:Reset() e:Reset() end)
			Duel.RegisterEffect(e2,tp)
		end
	elseif e1 then
		e1:Reset()
	end
end
