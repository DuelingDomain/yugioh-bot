if not aux.MPForEachController then return end
local function mp_actor(e,tp)
 return Duel.MPActionSeat and Duel.MPActionSeat() or tp
end
function s.filter(c,e,tp)
 if not c:IsFaceup() or not c:IsSetCard(SET_KAIJU) then return false end
 local deck=Duel.GetFieldGroup(tp,LOCATION_DECK,0)
 local actor=mp_actor(e,tp)
 local ok=false
 aux.MPForEachController(Group.FromCards(c),function(g,seat,p)
  ok=deck:IsExists(s.chkfilter,1,nil,e,actor,p,c:GetOriginalCode())
 end)
 return ok
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
 local c=e:GetHandler()
 local tc=Duel.GetFirstTarget()
 if not c:IsRelateToEffect(e) or not tc or not tc:IsRelateToEffect(e) then return end
 local deck=Duel.GetFieldGroup(tp,LOCATION_DECK,0)
 local actor=mp_actor(e,tp)
 local code=tc:GetOriginalCode()
 local candidates=Group.CreateGroup()
 local recipient=Duel.MPSeatOf(tc)
 aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
  if Duel.Destroy(tc,REASON_EFFECT)==0 or Duel.GetLocationCount(p,LOCATION_MZONE)<=0 then return end
  candidates=deck:Filter(s.spfilter,nil,e,actor,p,code)
 end)
 if #candidates==0 then return end
 Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
 local sg=candidates:Select(tp,1,1,nil)
 if #sg==0 then return end
 -- The destroyed card can change to its owner in the GY. Keep its field before destruction.
 -- recipient was saved before destruction.
 if recipient<0 then return end
 Duel.BreakEffect()
 if Duel.MPBindSeat(recipient) then
  Duel.SpecialSummon(sg,0,actor,1-tp,false,false,POS_FACEUP)
  Duel.MPBindSeat()
 elseif recipient==Duel.MPSeatOf(c) then
  Duel.SpecialSummon(sg,0,actor,tp,false,false,POS_FACEUP)
 else
  aux.MPForEachDuelist(function(p,seat)
   if seat~=recipient then return end
   Duel.SpecialSummon(sg,0,actor,p,false,false,POS_FACEUP)
   return true
  end)
 end
end

-- The text targets a Kaiju on the field. It does not refer to an opponent.
-- A shared field scan keeps all legal card targets and does not declare an opponent.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
 if chkc then return chkc:IsLocation(LOCATION_MZONE) and s.filter(chkc,e,tp) end
 if chk==0 then return Duel.IsExistingTarget(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil,e,tp) end
 local actor=Duel.MPActionSeat and Duel.MPActionSeat() or tp
 Duel.Hint(HINT_SELECTMSG,actor,HINTMSG_DESTROY)
 local g=Duel.SelectTarget(actor,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,e,tp)
 Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
 Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)
end
