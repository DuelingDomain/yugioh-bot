if not aux.MPForEachDuelist then return end
-- Every duelist may Special Summon 1 Level 4 or lower monster from its hand (R1, Q3, Tag partner included). The condition (a card of an
-- opponent was summoned) is stock.
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i)
		if Duel.GetLocationCount(tp_i,LOCATION_MZONE,tp_i)>0 then
			local g=Duel.GetMatchingGroup(s.filter,tp_i,LOCATION_HAND,0,nil,e,tp_i)
			if #g>0 and Duel.SelectYesNo(tp_i,aux.Stringid(id,0)) then
				Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_SPSUMMON)
				local tc=g:Select(tp_i,1,1,nil):GetFirst()
				Duel.SpecialSummonStep(tc,0,tp_i,tp_i,false,false,POS_FACEUP)
			end
		end
	end)
	Duel.SpecialSummonComplete()
end
