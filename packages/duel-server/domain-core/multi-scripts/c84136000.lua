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
-- The Grave of Enkindling: each living duelist targets from its own Graveyard. Tag includes the partner.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return false end
	if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
		and Duel.IsExistingTarget(s.spfilter,tp,LOCATION_GRAVE,0,1,nil,e,tp)
		and anyopp(function()
			return Duel.GetLocationCount(1-tp,LOCATION_MZONE)>0
				and Duel.IsExistingTarget(s.spfilter,1-tp,LOCATION_GRAVE,0,1,nil,e,1-tp)
		end) end
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local function filter(c) return Duel.MPSeatOf(c)==seat_i and s.spfilter(c,e,tp_i) end
		if Duel.GetLocationCount(tp_i,LOCATION_MZONE)>0
			and Duel.IsExistingTarget(filter,tp_i,LOCATION_GRAVE,0,1,nil) then
			Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_SPSUMMON)
			g:Merge(Duel.SelectTarget(tp_i,filter,tp_i,LOCATION_GRAVE,0,1,1,nil))
		end
	end)
	-- A non-nil Special Summon group with PLAYER_ALL must contain exactly two cards.
	if #g==2 then
		Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,#g,PLAYER_ALL,g:GetFirst():GetOwner())
	elseif #g>0 then
		Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,#g,tp,0)
	end
end
-- Each target is summoned for its own duelist. All summons complete together.
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetTargetCards(e)
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local tg=Duel.GetFieldGroup(tp_i,LOCATION_GRAVE,0):Filter(function(c)
			return Duel.MPSeatOf(c)==seat_i and g:IsContains(c)
		end,nil)
		for tc in aux.Next(tg) do
			if tc:IsRelateToEffect(e) and Duel.SpecialSummonStep(tc,0,tp_i,tp_i,false,false,POS_FACEUP_DEFENSE) then
				local e1=Effect.CreateEffect(e:GetHandler())
				e1:SetType(EFFECT_TYPE_SINGLE)
				e1:SetCode(EFFECT_CANNOT_CHANGE_POSITION)
				e1:SetReset(RESET_EVENT|RESETS_STANDARD)
				tc:RegisterEffect(e1,true)
			end
		end
	end)
	Duel.SpecialSummonComplete()
end
