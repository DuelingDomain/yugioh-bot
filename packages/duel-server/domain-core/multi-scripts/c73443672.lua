-- Underworld Circle: each living duelist is part of the Deck banish and the Standby Phase summon.
local function mp_all_deck_monsters()
 local g=Group.CreateGroup()
 aux.MPForEachDuelist(function(p)
  g:Merge(Duel.GetMatchingGroup(aux.AND(Card.IsAbleToRemove,Card.IsMonster),p,LOCATION_DECK,0,nil))
 end)
 return g
end
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(p) s.ignoresumconsp(e,p) end)
	Duel.SpecialSummonComplete()
end
local mp_target=s.target
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
 local result=mp_target(e,tp,eg,ep,ev,re,r,rp,chk)
 if chk~=0 then Duel.SetOperationInfo(0,CATEGORY_REMOVE,nil,1,0,0) end
 return result
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
    local g=Duel.GetMatchingGroup(nil,tp,LOCATION_MZONE,LOCATION_MZONE,nil)
    if #g>0 and Duel.Destroy(g,REASON_EFFECT)>0 then
		local rg=mp_all_deck_monsters()
		if #rg==0 then return end
		Duel.BreakEffect()
		if Duel.Remove(rg,POS_FACEDOWN,REASON_EFFECT)>0 and Duel.GetLocationCount(tp,LOCATION_MZONE)>0
			and Duel.IsExistingMatchingCard(aux.NecroValleyFilter(s.spnormalfilter),tp,LOCATION_GRAVE,0,1,nil,e,tp)
			and Duel.SelectYesNo(tp,aux.Stringid(id,2)) then
			Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
			local sg=Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spnormalfilter),tp,LOCATION_GRAVE,0,1,1,nil,e,tp)
			if #sg>0 then
				Duel.BreakEffect()
				Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)
			end
		end
	end
end

-- R-COMMON-EACH-PLAYER: every living duelist needs five monsters in the GY.
-- This condition does not declare an opponent. Tag checks each member's GY.
local mp_circle_condition=s.condition
function s.condition(e,tp,eg,ep,ev,re,r,rp)
 if Duel.MPMode()==0 then return mp_circle_condition(e,tp,eg,ep,ev,re,r,rp) end
 local eligible=true
 aux.MPForEachDuelist(function(p,seat)
  local count=Duel.GetMatchingGroupCount(function(c)
   return c:IsMonster() and Duel.MPSeatOf(c)==seat
  end,p,LOCATION_GRAVE,0,nil)
  if count<5 then eligible=false return true end
 end)
 return eligible
end
