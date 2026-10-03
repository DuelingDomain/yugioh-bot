if not aux.MPForEachController then return end
-- Banished cards identify their real owners; each owner has a separate return field.
function s.rmspop(e,tp,eg,ep,ev,re,r,rp)
 local actor=Duel.MPActionSeat and Duel.MPActionSeat() or tp
 local g=Duel.GetMatchingGroup(Card.IsAbleToRemove,tp,LOCATION_MZONE,LOCATION_MZONE,nil)
 if #g==0 or Duel.Remove(g,POS_FACEUP,REASON_EFFECT)==0 then return end
 local og=Duel.GetOperatedGroup()
 local summoned=Group.CreateGroup()
 aux.MPForEachController(og,function(cards,seat,p)
  local sg=cards:Filter(s.spfilter,nil,e,actor)
  local ft=Duel.GetLocationCount(p,LOCATION_MZONE)
  if ft<=0 or #sg==0 then return end
  if #sg>ft then
   Duel.Hint(HINT_SELECTMSG,actor,HINTMSG_SPSUMMON)
   sg=sg:Select(actor,ft,ft,nil)
  end
  for sc in sg:Iter() do
   local pos=0
   if sc:IsCanBeSpecialSummoned(e,0,actor,false,false,POS_FACEUP,p) then pos=pos|POS_FACEUP end
   if sc:IsCanBeSpecialSummoned(e,0,actor,false,false,POS_FACEDOWN_DEFENSE,p) then pos=pos|POS_FACEDOWN_DEFENSE end
   if pos~=0 and Duel.SpecialSummonStep(sc,0,actor,p,false,false,pos) then summoned:AddCard(sc) end
  end
 end)
 local fdg=summoned:Filter(Card.IsFacedown,nil)
 -- ConfirmCards broadcasts once to every opposing duelist and raises the reveal event once.
 if #fdg>0 then Duel.ConfirmCards(1-tp,fdg) end
 Duel.BreakEffect()
 Duel.SpecialSummonComplete()
end
