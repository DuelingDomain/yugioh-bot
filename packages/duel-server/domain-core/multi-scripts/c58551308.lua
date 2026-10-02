if not aux.MPAny then return end
-- Spear Cretin: "each player" is every living duelist (R1). The trigger target takes 1 monster from the Graveyard of you and of each opponent, one after the other.
function s.sptg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return false end
	if chk==0 then return e:GetHandler():GetFlagEffect(id)~=0 end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
	local g=Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,e:GetHandler(),e,tp)
	aux.MPEachOpponent(function()
		Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_SPSUMMON)
		g:Merge(Duel.SelectTarget(1-tp,s.filter,1-tp,LOCATION_GRAVE,0,1,1,e:GetHandler(),e,1-tp))
	end)()
	-- The core accepts CATEGORY_SPECIAL_SUMMON with PLAYER_ALL only for a group of exactly 2 cards (both sides summon): any other size is a Lua error.
	-- With one target per living duelist at 3 or 4 seats the group has more cards (or 1 card): the info names the activating player then.
	if #g==2 then
		Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,#g,PLAYER_ALL,g:GetFirst():GetOwner())
	elseif #g>0 then
		Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,#g,tp,0)
	end
end
-- The stock operation Special Summons each target for tc:GetControler(). The Lua value of a controller is 0 or 1 only, so at 3 or 4 seats a target of the
-- second opponent would be summoned for the first one. Each target is Special Summoned by the duelist whose Graveyard holds it (the own targets with no
-- window, the others inside the window of that opponent); the targets are one simultaneous Special Summon, so SpecialSummonComplete runs once at the end.
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	local sg=Duel.GetTargetCards(e)
	if #sg==0 then return end
	local function summon(tg,p)
		for tc in aux.Next(tg) do
			if Duel.GetLocationCount(p,LOCATION_MZONE)>0 then
				Duel.SpecialSummonStep(tc,0,p,p,false,false,POS_FACEUP_ATTACK|POS_FACEDOWN_DEFENSE)
			end
		end
	end
	summon(Duel.GetFieldGroup(tp,LOCATION_GRAVE,0):Filter(function(c) return sg:IsContains(c) end,nil),tp)
	aux.MPEachOpponent(function()
		summon(Duel.GetFieldGroup(tp,0,LOCATION_GRAVE):Filter(function(c) return sg:IsContains(c) end,nil),1-tp)
	end)()
	Duel.SpecialSummonComplete()
end
