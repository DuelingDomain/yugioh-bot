if not aux.MPForEachDuelist then return end
-- Every duelist may Special Summon 1 Level 4 monster from its hand (R1, Q3, Tag partner included). Each one is asked in turn order.
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i)
		if Duel.GetLocationCount(tp_i,LOCATION_MZONE)>0
			and Duel.IsExistingMatchingCard(s.filter,tp_i,LOCATION_HAND,0,1,nil,e,tp_i)
			and Duel.SelectYesNo(tp_i,aux.Stringid(id,1)) then
			Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_SPSUMMON)
			local g=Duel.SelectMatchingCard(tp_i,s.filter,tp_i,LOCATION_HAND,0,1,1,nil,e,tp_i)
			Duel.SpecialSummonStep(g:GetFirst(),0,tp_i,tp_i,false,false,POS_FACEUP)
		end
	end)
	Duel.SpecialSummonComplete()
end
