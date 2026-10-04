if not aux.MPForEachController then return end
-- R-TAG-SHARED-CARDS: query the controller team Graveyards; keep the real destination.
local function mp_gy_filter(c,e,tp,p,seat)
 return aux.MPKeyOfSeat(Duel.MPSeatOf(c))==aux.MPKeyOfSeat(seat) and s.spfilter(c,e,tp,p)
end
function s.rmfilter(c,e,tp)
 local actor=Duel.MPActionSeat and Duel.MPActionSeat() or tp
 if not c:IsRace(RACE_ZOMBIE) or not c:IsFaceup() or not c:IsAbleToRemove() then return false end
 local result=false
 aux.MPForEachController(Group.FromCards(c),function(g,seat,p)
  result=Duel.GetMZoneCount(p,c,tp)>0
   and Duel.IsExistingMatchingCard(mp_gy_filter,p,LOCATION_GRAVE,0,1,nil,e,actor,p,seat)
 end)
 return result
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
 local actor=Duel.MPActionSeat and Duel.MPActionSeat() or tp
 Duel.Hint(HINT_SELECTMSG,actor,HINTMSG_REMOVE)
 local rc=Duel.SelectMatchingCard(actor,s.rmfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,e,tp):GetFirst()
 if not rc then return end
 Duel.HintSelection(rc)
 aux.MPForEachController(Group.FromCards(rc),function(cards,seat,p)
  if Duel.Remove(rc,POS_FACEUP,REASON_EFFECT)==0 then return end
  Duel.Hint(HINT_SELECTMSG,actor,HINTMSG_SPSUMMON)
  local g=Duel.SelectMatchingCard(actor,mp_gy_filter,p,LOCATION_GRAVE,0,1,1,nil,e,actor,p,seat)
  if #g>0 then
   Duel.BreakEffect()
   Duel.SpecialSummon(g,0,actor,p,false,false,POS_FACEUP_DEFENSE)
  end
 end)
end
