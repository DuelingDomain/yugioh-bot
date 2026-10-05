if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- A living link keeps resolving after its source link is removed. Preserve independent actions.
function s.thdesop(e,tp,eg,ep,ev,re,r,rp)
	local mp_targets=Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)
	if not mp_targets then return end
	local tg=mp_targets:Filter(s.thconfilter,nil,re,tp)
	if #tg==0 then return end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_RTOHAND)
	local sc=tg:FilterSelect(tp,Card.IsAbleToHand,1,1,nil):GetFirst()
	if not sc then return end
	if sc:IsFaceup() then
		Duel.HintSelection(sc)
	else
		Duel.ConfirmCards(1-tp,sc)
	end
	if Duel.SendtoHand(sc,nil,REASON_EFFECT)>0 and sc:IsLocation(LOCATION_HAND) then
		Duel.ShuffleHand(sc:GetControler())
		local c=e:GetHandler()
		local exc=c:IsRelateToEffect(e) and c or nil
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
		local g=Duel.SelectMatchingCard(tp,nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,exc)
		if #g==0 then return end
		Duel.HintSelection(g)
		local code=sc:GetCode()
		if Duel.Destroy(g,REASON_EFFECT)>0 and Duel.GetLocationCount(tp,LOCATION_MZONE)>0
			and Duel.IsExistingMatchingCard(s.handspfilter,tp,LOCATION_HAND,0,1,nil,e,tp,code)
			and Duel.SelectYesNo(tp,aux.Stringid(id,2)) then
			Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
			local sg=Duel.SelectMatchingCard(tp,s.handspfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp,code)
			if #sg>0 then
				Duel.BreakEffect()
				Duel.SpecialSummon(sg,0,tp,tp,true,false,POS_FACEUP)
			end
		end
	end
end
