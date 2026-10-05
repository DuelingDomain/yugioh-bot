if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- A living link keeps resolving after its source link is removed. Preserve independent actions.
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local mp_targets=Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)
	if not mp_targets then return end
	local g=mp_targets:Filter(s.filter,nil,tp)
	if Duel.NegateActivation(ev) and re:GetHandler():IsRelateToEffect(re) and Duel.Destroy(eg,REASON_EFFECT)~=0 then
		local tg=g:Filter(Card.IsRelateToEffect,nil,re)
		local sg=Duel.GetMatchingGroup(s.spfilter,tp,LOCATION_EXTRA,0,nil,e,tp)
		if #tg>0 and #sg>0 and Duel.SelectYesNo(tp,aux.Stringid(id,0)) then
			Duel.BreakEffect()
			Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)
			local tc=tg:Select(tp,1,1,nil):GetFirst()
			if Duel.SendtoGrave(tc,REASON_EFFECT)==0 or not tc:IsLocation(LOCATION_GRAVE) then return end
			Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
			local sc=sg:Select(tp,1,1,nil):GetFirst()
			if Duel.SpecialSummonStep(sc,SUMMON_TYPE_FUSION,tp,tp,false,false,POS_FACEUP) then
				local e1=Effect.CreateEffect(e:GetHandler())
				e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
				e1:SetCode(EVENT_PHASE+PHASE_END)
				e1:SetCountLimit(1)
				e1:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
				e1:SetLabelObject(sc)
				e1:SetCondition(s.rmcon)
				e1:SetOperation(s.rmop)
				if Duel.IsTurnPlayer(tp) and Duel.IsPhase(PHASE_END) then
					e1:SetLabel(Duel.GetTurnCount())
					e1:SetReset(RESET_PHASE|PHASE_END|RESET_SELF_TURN,2)
				else
					e:SetLabel(0)
					e1:SetReset(RESET_PHASE|PHASE_END|RESET_SELF_TURN)
				end
				Duel.RegisterEffect(e1,tp)
				Duel.SpecialSummonComplete()
				sc:CompleteProcedure()
				sc:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD,0,1)
			end
		end
	end
end
