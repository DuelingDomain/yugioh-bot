-- Keep the stock operation when its target changes control or leaves play.
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if not tc or not tc:IsRelateToEffect(e) then return end
	local extra_tribute_eff=nil
	if tc:IsControler(1-tp) then
		--Tribute Summon 1 monster by Tributing monsters including the targeted opponent's monster, even though you do not control it
		extra_tribute_eff=Effect.CreateEffect(e:GetHandler())
		extra_tribute_eff:SetType(EFFECT_TYPE_SINGLE)
		extra_tribute_eff:SetCode(EFFECT_EXTRA_RELEASE)
		extra_tribute_eff:SetReset(RESET_EVENT|RESETS_STANDARD)
		tc:RegisterEffect(extra_tribute_eff,true)
	end
	--● Destroy it
	local option_1=true
	--● Immediately after this effect resolves, Tribute Summon 1 monster by Tributing monsters including the targeted opponent's monster, even though you do not control it
	local option_2=extra_tribute_eff and Duel.IsExistingMatchingCard(Card.CanSummonOrSet,tp,LOCATION_HAND,0,1,nil,true,nil,1)
	local choice=Duel.SelectEffect(tp,
		{option_1,aux.Stringid(id,2)},
		{option_2,aux.Stringid(id,3)})
	if choice==1 then
		--● Destroy it
		if extra_tribute_eff then extra_tribute_eff:Reset() end
		Duel.Destroy(tc,REASON_EFFECT)
	elseif choice==2 then
		--● Immediately after this effect resolves, Tribute Summon 1 monster by Tributing monsters including the targeted opponent's monster, even though you do not control it
		local sc=Duel.SelectMatchingCard(tp,Card.CanSummonOrSet,tp,LOCATION_HAND,0,1,1,nil,true,nil,1):GetFirst()
		if sc then
			Duel.SummonOrSet(tp,sc,true,nil,1)
		end
	end
end
