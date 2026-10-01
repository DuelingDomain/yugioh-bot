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
-- The Shallow Grave: "each player" is every living duelist (R1). It can be activated when you and at least one opponent can Special Summon;
-- every opposing duelist who can targets 1 monster in their own Graveyard, one after the other. Each target is Special Summoned by its controller.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return false end
	if chk==0 then
		return Duel.IsExistingTarget(s.filter,tp,LOCATION_GRAVE,0,1,nil,e,tp)
			and Duel.GetLocationCount(tp,LOCATION_MZONE)>0
			and anyopp(function()
				return Duel.IsExistingTarget(s.filter,1-tp,LOCATION_GRAVE,0,1,nil,e,1-tp)
					and Duel.GetLocationCount(1-tp,LOCATION_MZONE,1-tp)>0
			end)
	end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
	local g=Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)
	e:SetLabelObject(g:GetFirst())
	-- picks[i] is the target of the i-th opposing duelist (the operation reads it in the same window order)
	s.picks={}
	aux.MPEachOpponent(function(i)
		if Duel.IsExistingTarget(s.filter,1-tp,LOCATION_GRAVE,0,1,nil,e,1-tp)
			and Duel.GetLocationCount(1-tp,LOCATION_MZONE,1-tp)>0 then
			Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_SPSUMMON)
			local og=Duel.SelectTarget(1-tp,s.filter,1-tp,LOCATION_GRAVE,0,1,1,nil,e,1-tp)
			s.picks[i]=og:GetFirst()
			g:Merge(og)
		end
	end)()
	-- The core accepts PLAYER_ALL with CATEGORY_SPECIAL_SUMMON only for a group of exactly 2 cards (the summon counters of both players).
	-- With 3 or more targets (FFA3, FFA4) the info names the activating player alone.
	if #g==2 then
		Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,#g,PLAYER_ALL,g:GetFirst():GetOwner())
	else
		Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,#g,tp,0)
	end
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local sc=e:GetLabelObject()
	local g=Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)
	if sc and sc:IsRelateToEffect(e) then
		Duel.SpecialSummonStep(sc,0,tp,tp,false,false,POS_FACEDOWN_DEFENSE)
	end
	-- One window per opposing duelist: the target of that duelist is Special Summoned to its own field.
	aux.MPEachOpponent(function(i)
		local tc=s.picks and s.picks[i]
		if tc and g:IsContains(tc) and tc:IsRelateToEffect(e) then
			Duel.SpecialSummonStep(tc,0,1-tp,1-tp,false,false,POS_FACEDOWN_DEFENSE)
		end
	end)()
	Duel.SpecialSummonComplete()
end
