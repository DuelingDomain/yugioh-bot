if not aux.MPAny then return end
local function anyopp(fn)
	if Duel.MPMode()==0 then return fn() end
	for i=1,Duel.MPOppCount() do
		Duel.MPWindow(i)
		local r=fn()
		Duel.MPWindowEnd()
		if r then return true end
	end
	return false
end
-- Different Dimension Encounter: "each player" is every living duelist (R1). It can be activated when you and at least one opponent can Special Summon;
-- then every opposing duelist who can Special Summons 1 of their banished monsters, one after the other.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
			and Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_REMOVED,0,1,nil,e,tp)
			and anyopp(function()
				return Duel.GetLocationCount(1-tp,LOCATION_MZONE,1-tp)>0
					and Duel.IsExistingMatchingCard(s.filter,1-tp,LOCATION_REMOVED,0,1,nil,e,1-tp)
			end)
	end
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,2,PLAYER_ALL,0)
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	if Duel.GetLocationCount(tp,LOCATION_MZONE)>0 then
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
		local g=Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_REMOVED,0,1,1,nil,e,tp)
		local tc=g:GetFirst()
		if tc then Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEDOWN_DEFENSE) end
	end
	aux.MPEachOpponent(function()
		if Duel.GetLocationCount(1-tp,LOCATION_MZONE)>0 then
			Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_SPSUMMON)
			local g=Duel.SelectMatchingCard(1-tp,s.filter,1-tp,LOCATION_REMOVED,0,1,1,nil,e,1-tp)
			local tc=g:GetFirst()
			if tc then Duel.SpecialSummonStep(tc,0,1-tp,1-tp,false,false,POS_FACEDOWN_DEFENSE) end
		end
	end)()
	Duel.SpecialSummonComplete()
end
