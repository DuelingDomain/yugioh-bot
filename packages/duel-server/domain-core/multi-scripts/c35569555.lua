if not aux.MPTarget or not aux.MPOne then return end
-- The activation's opponent monster check is an eligibility condition only.
-- The Extra Deck ignition effect keeps its activation declaration.
local mp_matrix_activate=s.activate
local function mp_matrix_has_opponent_monster(tp)
 for i=1,Duel.MPOppCount() do
  Duel.MPWindow(i)
  local count=Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)
  Duel.MPWindowEnd()
  if count>0 then return true end
 end
 return false
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
 if Duel.MPMode()~=1 then return mp_matrix_activate(e,tp,eg,ep,ev,re,r,rp) end
 local g=Duel.GetMatchingGroup(s.thfilter1,tp,LOCATION_DECK,0,nil,true)
 if #g>0 and Duel.SelectYesNo(tp,aux.Stringid(id,0)) then
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
  local sg=g:Select(tp,1,1,nil)
  Duel.SendtoHand(sg,nil,REASON_EFFECT)
  Duel.ConfirmCards(1-tp,sg)
  g=Duel.GetMatchingGroup(s.thfilter2,tp,LOCATION_DECK,0,nil)
  if #g>0 and mp_matrix_has_opponent_monster(tp) and Duel.SelectYesNo(tp,aux.Stringid(id,2)) then
   Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
   sg=g:Select(tp,1,1,nil)
   Duel.BreakEffect()
   Duel.SendtoHand(sg,nil,REASON_EFFECT)
   Duel.ConfirmCards(1-tp,sg)
  end
 end
end

-- Declare the opponent for the Extra Deck ignition effect at activation.
s.gytg=aux.MPTarget(s.gytg)
s.gyop=aux.MPOne(s.gyop)
