if not aux.MPForEachController then return end
-- The returned hand card identifies the actual duelist who can summon.
function s.rthop(e,tp,eg,ep,ev,re,r,rp)
 local tc=Duel.GetFirstTarget()
 if not tc or not tc:IsRelateToEffect(e) or Duel.SendtoHand(tc,nil,REASON_EFFECT)==0 or not tc:IsLocation(LOCATION_HAND) then return end
 aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
  Duel.ShuffleHand(p)
  if Duel.GetLocationCount(p,LOCATION_MZONE,p)>0
   and Duel.IsExistingMatchingCard(Card.IsCanBeSpecialSummoned,p,LOCATION_HAND,0,1,nil,e,0,p,false,false,POS_FACEDOWN_DEFENSE)
   and Duel.SelectYesNo(p,aux.Stringid(id,2)) then
   Duel.Hint(HINT_SELECTMSG,p,HINTMSG_SPSUMMON)
   local sg=Duel.SelectMatchingCard(p,Card.IsCanBeSpecialSummoned,p,LOCATION_HAND,0,1,1,nil,e,0,p,false,false,POS_FACEDOWN_DEFENSE)
   if #sg>0 then
    Duel.BreakEffect()
    Duel.SpecialSummon(sg,0,p,p,false,false,POS_FACEDOWN_DEFENSE)
   end
  end
 end)
end
