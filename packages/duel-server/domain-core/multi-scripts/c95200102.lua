if not aux.MPForEachDuelist then return end
-- Every duelist may Special Summon 1 "illegal" monster from its own Extra Deck, and may draw 1 card for it (R1, Q3, Tag partner included).
-- The duelist that is asked is tp_i (the stock script asks player 0 for the draw of the activator).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i)
		local g=Duel.GetMatchingGroup(s.filter,tp_i,LOCATION_EXTRA,0,nil,e,tp_i)
		if #g>0 and Duel.GetLocationCount(tp_i,LOCATION_MZONE)>0 and Duel.SelectYesNo(tp_i,aux.Stringid(102380,0)) then
			Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_SPSUMMON)
			local sg=g:Select(tp_i,1,1,nil)
			if Duel.SpecialSummonStep(sg:GetFirst(),0,tp_i,tp_i,true,false,POS_FACEUP) and Duel.SelectYesNo(tp_i,aux.Stringid(1102515,0)) then
				Duel.Draw(tp_i,1,REASON_EFFECT)
			end
		end
	end)
	Duel.SpecialSummonComplete()
end
