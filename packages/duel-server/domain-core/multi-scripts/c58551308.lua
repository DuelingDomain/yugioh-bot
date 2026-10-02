if not aux.MPAny then return end
-- Spear Cretin: "each player" is every living duelist (R1). Each duelist selects from its own Graveyard and summons to its own field.
function s.sptg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return false end
	if chk==0 then return e:GetHandler():GetFlagEffect(id)~=0 end
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i,seat_i)
		Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_SPSUMMON)
		-- Tag queries include the partner's Graveyard; each choice must belong to this duelist.
		g:Merge(Duel.SelectTarget(tp_i,function(c)
			return Duel.MPSeatOf(c)==seat_i and s.filter(c,e,tp_i)
		end,tp_i,LOCATION_GRAVE,0,1,1,e:GetHandler()))
	end)
	-- The core accepts CATEGORY_SPECIAL_SUMMON with PLAYER_ALL only for a group of exactly 2 cards (both sides summon): any other size is a Lua error.
	-- With one target per living duelist at 3 or 4 seats the group has more cards (or 1 card): the info names the activating player then.
	if #g==2 then
		Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,#g,PLAYER_ALL,g:GetFirst():GetOwner())
	elseif #g>0 then
		Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,#g,tp,0)
	end
end
-- Each target is summoned in the scope of the duelist whose Graveyard contains it. All summons complete together.
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	local sg=Duel.GetTargetCards(e)
	if #sg==0 then return end
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local tg=Duel.GetFieldGroup(tp_i,LOCATION_GRAVE,0):Filter(function(c)
			return Duel.MPSeatOf(c)==seat_i and sg:IsContains(c)
		end,nil)
		for tc in aux.Next(tg) do
			if Duel.GetLocationCount(tp_i,LOCATION_MZONE)>0 then
				Duel.SpecialSummonStep(tc,0,tp_i,tp_i,false,false,POS_FACEUP_ATTACK|POS_FACEDOWN_DEFENSE)
			end
		end
	end)
	Duel.SpecialSummonComplete()
end
