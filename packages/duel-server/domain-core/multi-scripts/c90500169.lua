if not aux.MPForEachController then return end
local function mp_gy_filter(c,e,tp,p,lvnum,lvset,seat)
 return aux.MPKeyOfSeat(Duel.MPSeatOf(c))==aux.MPKeyOfSeat(seat) and s.spfilter(c,e,tp,p,lvnum,lvset)
end
-- P61 can identify exact FFA owners. Exact Tag owners need MPOwnerSeat.
local function mp_owner(c,tp,fn)
 local owner
 if Duel.MPOwnerSeat then owner=Duel.MPOwnerSeat(c)
 elseif Duel.MPMode()==1 then
  aux.MPForEachDuelist(function(p,seat)
   if c:GetOwner()==p then owner=seat return true end
  end)
 else
  aux.MPForEachController(Group.FromCards(c),function(g,seat,p) fn(c:GetOwner(),seat) end)
  return
 end
 if owner==nil or owner<0 then return end
 if aux.MPKeyOfSeat(owner)~=aux.MPKey(tp) then
  if Duel.MPBindSeat(owner) then fn(1-tp,owner) end
  Duel.MPBindSeat()
 elseif Duel.MPMode()==2 then
  aux.MPForEachDuelist(function(p,seat)
   if seat==owner then fn(p,seat) return true end
  end)
 else fn(tp,owner) end
end
function s.tdfilter(c,e,tp)
 local actor=Duel.MPActionSeat and Duel.MPActionSeat() or tp
 if not (c:IsSetCard(SET_LV) and c:IsFaceup() and c:IsAbleToDeck()) then return false end
 local class=c:GetMetatable(true)
 if not class or not class.LVnum or not class.LVset then return false end
 local result=false
 mp_owner(c,tp,function(p,seat)
  result=Duel.GetMZoneCount(p,c,tp)>0
   and Duel.IsExistingMatchingCard(mp_gy_filter,p,LOCATION_GRAVE,0,1,nil,e,actor,p,class.LVnum,class.LVset,seat)
 end)
 return result
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
 local tc=Duel.GetFirstTarget()
 if not tc or not tc:IsRelateToEffect(e) or not tc:IsFaceup() then return end
 local actor=Duel.MPActionSeat and Duel.MPActionSeat() or tp
 local class=tc:GetMetatable(true)
 if not class or not class.LVnum or not class.LVset then return end
 if Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)==0 or not tc:IsLocation(LOCATION_DECK|LOCATION_EXTRA) then return end
 aux.MPForEachController(Group.FromCards(tc),function(cards,seat,p)
  if Duel.GetLocationCount(p,LOCATION_MZONE)<=0 then return end
  Duel.Hint(HINT_SELECTMSG,actor,HINTMSG_SPSUMMON)
  local g=Duel.SelectMatchingCard(actor,mp_gy_filter,p,LOCATION_GRAVE,0,1,1,nil,e,actor,p,class.LVnum,class.LVset,seat)
  if #g>0 then Duel.SpecialSummon(g,0,actor,p,true,false,POS_FACEUP) end
 end)
end
-- The target names one real owner; operation metadata must not ask for another opponent.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
 if chkc then return chkc:IsLocation(LOCATION_MZONE) and s.tdfilter(chkc,e,tp) end
 if chk==0 then return Duel.IsExistingTarget(s.tdfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil,e,tp) end
 local actor=Duel.MPActionSeat and Duel.MPActionSeat() or tp
 Duel.Hint(HINT_SELECTMSG,actor,HINTMSG_TODECK)
 local tc=Duel.SelectTarget(actor,s.tdfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,e,tp):GetFirst()
 Duel.SetOperationInfo(0,CATEGORY_TODECK,tc,1,tp,0)
 Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,PLAYER_ALL,LOCATION_GRAVE)
end
