if not aux.MPForEachController then return end
local mp_filter=s.filter
function s.filter(c,e,tp)
 local result=false
 aux.MPForEachController(Group.FromCards(c),function(g,seat,p) result=mp_filter(c,e,tp) end)
 return result
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
 local tc=Duel.GetFirstTarget()
 if not tc or not tc:IsRelateToEffect(e) then return end
 local actor=Duel.MPActionSeat and Duel.MPActionSeat() or tp
 local can_summon=false
 aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
  can_summon=Duel.GetLocationCount(p,LOCATION_MZONE)>0 and tc:IsCanBeSpecialSummoned(e,0,actor,false,false,POS_FACEUP,p)
 end)
 if can_summon and (not tc:IsAbleToDeck() or Duel.SelectYesNo(tp,aux.Stringid(id,0))) then
  aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
   Duel.SpecialSummon(tc,0,actor,p,false,false,POS_FACEUP)
  end)
 else
  Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)
 end
end
