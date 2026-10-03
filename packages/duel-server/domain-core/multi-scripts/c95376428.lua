if not aux.MPPick or Duel.MPMode()~=2 then return end
-- Only an own-team summon lets an opposing duelist draw.
local stock=s.target
s.target=aux.MPPick(s.target)
local pick=s.target
function s.target(e,tp,eg,...)
 if eg and eg:IsExists(Card.IsSummonPlayer,1,nil,tp) then
  return pick(e,tp,eg,...)
 end
 return stock(e,tp,eg,...)
end
