if not aux.MPForEachController then return end
-- Keep the token owner and summon player in the original actor scope.
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if tc:IsRelateToEffect(e) then
		local actor=Duel.MPActionSeat and Duel.MPActionSeat() or tp
		local token=Duel.CreateToken(tp,TOKEN_ROSE)
		local e1=Effect.CreateEffect(e:GetHandler())
		e1:SetType(EFFECT_TYPE_FIELD)
		e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
		e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
		e1:SetDescription(aux.Stringid(id,1))
		e1:SetTargetRange(1,0)
		e1:SetTarget(s.splimit)
		e1:SetReset(RESET_PHASE|PHASE_END)
		Duel.RegisterEffect(e1,tp)
		--Clock Lizard check
		aux.addTempLizardCheck(e:GetHandler(),tp,s.lizfilter)
		aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
		if Duel.Destroy(tc,REASON_EFFECT)>0 then
			if Duel.GetLocationCount(p,LOCATION_MZONE)>0
				and Duel.IsPlayerCanSpecialSummonMonster(actor,TOKEN_ROSE,0,TYPES_TOKEN,800,800,2,RACE_PLANT,ATTRIBUTE_DARK,POS_FACEUP_ATTACK,p) then
				Duel.SpecialSummon(token,0,actor,p,false,false,POS_FACEUP_ATTACK)
			end
		end
		end)
	end
end
