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
-- then each living duelist Special Summons 1 of its own banished monsters. Tag includes the partner.
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
	aux.MPForEachDuelistFromTurn(function(tp_i,seat_i)
		if Duel.GetLocationCount(tp_i,LOCATION_MZONE)>0 then
			Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_SPSUMMON)
			local g=Duel.SelectMatchingCard(tp_i,function(c)
				return Duel.MPSeatOf(c)==seat_i and s.filter(c,e,tp_i)
			end,tp_i,LOCATION_REMOVED,0,1,1,nil)
			local tc=g:GetFirst()
			if tc then Duel.SpecialSummonStep(tc,0,tp_i,tp_i,false,false,POS_FACEDOWN_DEFENSE) end
		end
	end)
	Duel.SpecialSummonComplete()
end
