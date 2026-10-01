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
	-- The core accepts CATEGORY_SPECIAL_SUMMON with PLAYER_ALL only for a group of exactly 2 cards (both sides summon). With one target per
	-- living duelist at 3 or 4 seats the group has more cards: it is stored for the activator then, the stock info of the group.
	if #g==2 then
		Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,#g,PLAYER_ALL,g:GetFirst():GetOwner())
	else
		Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,#g,tp,g:GetFirst():GetOwner())
	end
end
-- The stock operation Special Summons each target for tc:GetControler(). The Lua value of a controller is 0 or 1 only, so at 3 or 4 seats a target of the
-- second opponent would be summoned for the first one. Each target is summoned inside the window of the duelist that controls it (the own targets with no
-- window; a window shows the Graveyard of one opponent only, and a card is not told apart by its controller value); the targets are one simultaneous Special Summon, so SpecialSummonComplete runs once after the last window.
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)
	local function summon(tg)
		for tc in aux.Next(tg) do
			if tc:IsRelateToEffect(e) and Duel.SpecialSummonStep(tc,0,tc:GetControler(),tc:GetControler(),false,false,POS_FACEUP_DEFENSE) then
				local e1=Effect.CreateEffect(e:GetHandler())
				e1:SetType(EFFECT_TYPE_SINGLE)
				e1:SetCode(EFFECT_CANNOT_CHANGE_POSITION)
				e1:SetReset(RESET_EVENT|RESETS_STANDARD)
				tc:RegisterEffect(e1,true)
			end
		end
	end
	summon(Duel.GetFieldGroup(tp,LOCATION_GRAVE,0):Filter(function(c) return g:IsContains(c) end,nil))
	aux.MPEachOpponent(function()
		summon(Duel.GetFieldGroup(tp,0,LOCATION_GRAVE):Filter(function(c) return g:IsContains(c) end,nil))
	end)()
	Duel.SpecialSummonComplete()
end
