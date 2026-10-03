if not aux.MPForEachDuelist then return end
-- Every duelist gains 1000 LP (R1, Q3, Tag partner included). When one gains nothing the effect ends, as in the stock text.
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local ok=true
	aux.MPForEachDuelist(function(tp_i)
		if Duel.Recover(tp_i,1000,REASON_EFFECT)==0 then ok=false return true end
	end)
	if not ok then return end
	if Duel.IsExistingMatchingCard(Card.IsDiscardable,tp,LOCATION_HAND,0,1,nil)
		and Duel.GetLocationCount(tp,LOCATION_MZONE)>0
		and Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_DECK,0,1,nil,e,tp)
		and Duel.SelectYesNo(tp,aux.Stringid(id,2)) then
		Duel.BreakEffect()
		if Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_EFFECT|REASON_DISCARD,nil)>0 then
			Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
			local g=Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)
			if #g>0 then
				Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)
			end
		end
	end
end
