if not aux.MPForEachDuelist then return end
-- Magician's Circle: "each player" is every living duelist (R1, Q3, Tag partner included). The activator needs a Spellcaster in the Deck;
-- every duelist needs a free Monster Zone. Each duelist picks from its own Deck, then the monsters are Special Summoned together.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_DECK,0,1,nil,e,tp)
		and aux.MPAllDuelists(function(tp_i) return Duel.GetLocationCount(tp_i,LOCATION_MZONE)>0 end) end
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,PLAYER_ALL,LOCATION_DECK)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i)
		if Duel.GetLocationCount(tp_i,LOCATION_MZONE)>0 then
			Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_SPSUMMON)
			local g=Duel.SelectMatchingCard(tp_i,s.filter,tp_i,LOCATION_DECK,0,1,1,nil,e,tp_i)
			local tc=g:GetFirst()
			if tc then Duel.SpecialSummonStep(tc,0,tp_i,tp_i,false,false,POS_FACEUP_ATTACK) end
		end
	end)
	Duel.SpecialSummonComplete()
end
