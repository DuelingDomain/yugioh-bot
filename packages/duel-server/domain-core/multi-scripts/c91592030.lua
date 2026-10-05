if not aux.MPAny then return end
-- Intimidating Ore - Summonite: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	local ft=Duel.GetLocationCount(tp,LOCATION_MZONE)
	if ft==0 then return end
	local g=Duel.GetTargetCards(e)
	if #g==0 or not s.sprescon(g,e,tp) then return end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SELECT)
	local tc=g:Select(tp,1,1,nil):GetFirst()
	if not tc then return end
	Duel.HintSelection(tc,true)
	g:RemoveCard(tc)
	local b1=tc:IsCanBeSpecialSummoned(e,0,tp,false,false)
	local b2=#g:Match(Card.IsCanBeSpecialSummoned,nil,e,0,tp,false,false)>0
	if not aux.MPChooseOpponent(tp) then return end
	local op=Duel.SelectEffect(1-tp,
		{b1,aux.Stringid(id,1)},
		{b2,aux.Stringid(id,2)})
	if op==1 then
		Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)
	elseif op==2 then
		if Duel.IsPlayerAffectedByEffect(tp,CARD_BLUEEYES_SPIRIT) then ft=1 end
		if ft<#g then
			Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
			g=g:Select(tp,ft,ft,nil)
		end
		if #g>0 then
			Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)
		end
	end
end
