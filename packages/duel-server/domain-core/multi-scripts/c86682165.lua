if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.immop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	--Monsters cannot be destroyed or banished opponent's effects
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_FIELD)
	e1:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
	e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)
	e1:SetTargetRange(LOCATION_MZONE,0)
	e1:SetValue(aux.indoval)
	e1:SetReset(RESET_PHASE|PHASE_END)
	Duel.RegisterEffect(e1,tp)
	local e2=Effect.CreateEffect(c)
	e2:SetType(EFFECT_TYPE_FIELD)
	e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	e2:SetCode(EFFECT_CANNOT_REMOVE)
	e2:SetTargetRange(1,1)
	e2:SetTarget(s.remtg)
	e2:SetReset(RESET_PHASE|PHASE_END)
	Duel.RegisterEffect(e2,tp)
	aux.RegisterClientHint(c,0,tp,1,0,aux.Stringid(id,2),RESET_PHASE|PHASE_END,1)
	local ch=Duel.MPPreviousChain()
	if ch==0 then return end
	local chp,chcode=Duel.GetChainInfo(ch,CHAININFO_TRIGGERING_PLAYER,CHAININFO_TRIGGERING_CODE)
	if chp~=1-tp or not chcode then return end
	local g=Duel.GetMatchingGroup(s.rmfilter,tp,0,LOCATION_ONFIELD|LOCATION_GRAVE,nil,chcode)
	if #g>0 and Duel.SelectYesNo(tp,aux.Stringid(id,3)) then
		Duel.BreakEffect()
		Duel.Remove(g,POS_FACEUP,REASON_EFFECT)
	end
end
