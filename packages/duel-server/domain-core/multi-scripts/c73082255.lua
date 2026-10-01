if not aux.MPForEachDuelist then return end
-- Every duelist sends the top 4 cards of its Deck to the GY (R1, Q3, Tag partner included). The target needs every duelist to be able to.
function s.gytg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDiscardDeck(tp_i,4) end) end
	Duel.SetOperationInfo(0,CATEGORY_DECKDES,0,0,PLAYER_ALL,4)
	Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,PLAYER_EITHER,LOCATION_GRAVE)
end
function s.gyop(e,tp,eg,ep,ev,re,r,rp)
	local og=Group.CreateGroup()
	local sent=0
	aux.MPForEachDuelist(function(tp_i)
		sent=sent+Duel.DiscardDeck(tp_i,4,REASON_EFFECT)
		og:Merge(Duel.GetOperatedGroup())
	end)
	if sent==0 then return end
	if #og>0 and Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and og:IsExists(aux.NecroValleyFilter(s.spfilter),1,nil,e,tp)
		and Duel.SelectYesNo(tp,aux.Stringid(id,1)) then
		Duel.BreakEffect()
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
		local sg=og:FilterSelect(tp,s.spfilter,1,1,nil,e,tp)
		Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)
	end
end
