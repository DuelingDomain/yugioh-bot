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
-- The Grave of Enkindling: "each player" is every living duelist (R1). It can be activated when you and at least one opponent can Special Summon;
-- every opposing duelist who can targets 1 monster in their own Graveyard, one after the other. The stock operation Special Summons each target for its controller.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return false end
	if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
		and Duel.IsExistingTarget(s.spfilter,tp,LOCATION_GRAVE,0,1,nil,e,tp)
		and anyopp(function()
			return Duel.GetLocationCount(1-tp,LOCATION_MZONE)>0
				and Duel.IsExistingTarget(s.spfilter,1-tp,LOCATION_GRAVE,0,1,nil,e,1-tp)
		end) end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
	local g=Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)
	aux.MPEachOpponent(function()
		if Duel.GetLocationCount(1-tp,LOCATION_MZONE)>0
			and Duel.IsExistingTarget(s.spfilter,1-tp,LOCATION_GRAVE,0,1,nil,e,1-tp) then
			Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_SPSUMMON)
			g:Merge(Duel.SelectTarget(1-tp,s.spfilter,1-tp,LOCATION_GRAVE,0,1,1,nil,e,1-tp))
		end
	end)()
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,#g,PLAYER_ALL,g:GetFirst():GetOwner())
end
