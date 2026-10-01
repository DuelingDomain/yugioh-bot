if not aux.MPForEachDuelist then return end
-- After the Special Summon every duelist discards 1 card (R1, Q3, Tag partner included). The condition asks if ANY duelist has a card in
-- hand. The duelist that runs the effect discards first. The first effect (a replaced chain link, the opponent discards) stays stock.
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	if Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
	local g=Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_GRAVE|LOCATION_REMOVED,0,1,1,nil,e,tp)
	if #g>0 and Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)>0
		and aux.MPAnyDuelist(function(tp_i) return Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0)>0 end) then
		Duel.BreakEffect()
		aux.MPForEachDuelist(function(tp_i)
			Duel.DiscardHand(tp_i,nil,1,1,REASON_EFFECT|REASON_DISCARD)
		end)
	end
end
