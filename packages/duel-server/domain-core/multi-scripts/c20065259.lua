if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- A living link keeps resolving after its source link is removed. Preserve independent actions.
function s.ssptg(e,tp,eg,ep,ev,re,r,rp,chk)
	local c=e:GetHandler()
	if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
		and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEDOWN_DEFENSE) end
	local mp_targets=Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)
	local tc=mp_targets and mp_targets:GetFirst()
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,LOCATION_GRAVE)
	if tc then Duel.SetOperationInfo(0,CATEGORY_TOHAND,tc,1,tp,0) end
end
function s.sspop(e,tp,eg,ep,ev,re,r,rp)
	if Duel.GetLocationCount(tp,LOCATION_MZONE)==0 then return end
	local c=e:GetHandler()
	if c:IsRelateToEffect(e) and Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEDOWN_DEFENSE)>0 then
		local mp_targets=Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)
		local tc=mp_targets and mp_targets:GetFirst()
		if tc and tc:IsRelateToEffect(re) then
			Duel.SendtoHand(tc,nil,REASON_EFFECT)
		end
	end
end
