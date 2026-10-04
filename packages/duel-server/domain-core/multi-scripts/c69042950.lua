if not aux.MPForEachDuelist then return end
-- The activator Special Summons a monster from its hand; every other duelist (an opponent, the Tag partner) may do the same (R1, Q3).
-- The first duelist of the loop is the activator.
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local first=true
	aux.MPForEachDuelist(function(tp_i)
		local own=first
		first=false
		if Duel.GetLocationCount(tp_i,LOCATION_MZONE)>0 then
			if own then
				Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_SPSUMMON)
				local g=Duel.SelectMatchingCard(tp_i,s.spfilter,tp_i,LOCATION_HAND,0,1,1,nil,e,tp_i)
				if #g~=0 then Duel.SpecialSummonStep(g:GetFirst(),0,tp_i,tp_i,false,false,POS_FACEUP) end
			elseif Duel.IsExistingMatchingCard(s.spfilter,tp_i,LOCATION_HAND,0,1,nil,e,tp_i)
				and Duel.SelectYesNo(tp_i,aux.Stringid(id,0)) then
				Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_SPSUMMON)
				local g=Duel.SelectMatchingCard(tp_i,s.spfilter,tp_i,LOCATION_HAND,0,1,1,nil,e,tp_i)
				if #g~=0 then Duel.SpecialSummonStep(g:GetFirst(),0,tp_i,tp_i,false,false,POS_FACEUP) end
			end
		end
	end)
	Duel.SpecialSummonComplete()
end

-- An opponent's level is an eligibility check for this each-player action.
local mp_road_target=s.target
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
 if Duel.MPMode()~=1 or chk~=0 then return mp_road_target(e,tp,eg,ep,ev,re,r,rp,chk) end
 for i=1,Duel.MPOppCount() do
  Duel.MPWindow(i)
  local ok=mp_road_target(e,tp,eg,ep,ev,re,r,rp,chk)
  Duel.MPWindowEnd()
  if ok then return true end
 end
 return false
end
