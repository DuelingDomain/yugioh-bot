if not aux.MPAny then return end
-- Vaalmonica Intonare: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	Duel.SetPossibleOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,500)
	Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_GRAVE)
	Duel.SetPossibleOperationInfo(0,CATEGORY_DAMAGE,nil,0,tp,500)
	Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_GRAVE)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp,angello_or_dimonno) --Additional parameter used by "Angello Vaalmonica" and "Dimonno Vaalmonica"
	local picked_opponent=false
	local op=nil
	if angello_or_dimonno then
		op=angello_or_dimonno
	else
		local sel_player=Duel.IsExistingMatchingCard(Card.IsSetCard,tp,LOCATION_PZONE,0,1,nil,SET_VAALMONICA) and tp or 1-tp
		local offset=sel_player==1-tp and 2 or 0
		if sel_player==1-tp then
			if not aux.MPChooseOpponent(tp) then return end
			picked_opponent=true
		end
		op=Duel.SelectEffect(sel_player,
			{true,aux.Stringid(id,1+offset)},
			{true,aux.Stringid(id,2+offset)})
	end
	if op==1 then
		--Gain 500 LP and Special Summon 1 monster from your GY
		local g=Duel.GetMatchingGroup(aux.NecroValleyFilter(s.spfilter),tp,LOCATION_GRAVE,0,nil,e,tp)
		if Duel.Recover(tp,500,REASON_EFFECT)>0 and #g>0 then
			if not picked_opponent and not aux.MPChooseOpponent(tp) then return end
			Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_SPSUMMON)
			local sg=g:Select(1-tp,1,1,nil)
			Duel.BreakEffect()
			Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)
		end
	elseif op==2 then
		--Take 500 damage and add 1 Level 4 monster from your GY to your hand
		local g=Duel.GetMatchingGroup(aux.NecroValleyFilter(s.thfilter),tp,LOCATION_GRAVE,0,nil)
		if Duel.Damage(tp,500,REASON_EFFECT)>0 and #g>0 and Duel.SelectYesNo(tp,aux.Stringid(id,5)) then
			Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
			local hg=g:Select(tp,1,1,nil)
			Duel.BreakEffect()
			Duel.SendtoHand(hg,nil,REASON_EFFECT)
			Duel.ConfirmCards(1-tp,hg)
		end
	end
end
