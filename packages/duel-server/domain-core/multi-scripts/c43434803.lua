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
	aux.MPEachOpponent(function()
		if Duel.IsExistingTarget(s.filter,1-tp,LOCATION_GRAVE,0,1,nil,e,1-tp)
			and Duel.GetLocationCount(1-tp,LOCATION_MZONE,1-tp)>0 then
			Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_SPSUMMON)
			g:Merge(Duel.SelectTarget(1-tp,s.filter,1-tp,LOCATION_GRAVE,0,1,1,nil,e,1-tp))
		end
	end)()
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,#g,PLAYER_ALL,g:GetFirst():GetOwner())
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local sc=e:GetLabelObject()
	local g=Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)
	for tc in aux.Next(g) do
		if tc:IsRelateToEffect(e) then
			local p=tp
			if tc~=sc then p=tc:GetControler() end
			Duel.SpecialSummonStep(tc,0,p,p,false,false,POS_FACEDOWN_DEFENSE)
		end
	end
	Duel.SpecialSummonComplete()
end
