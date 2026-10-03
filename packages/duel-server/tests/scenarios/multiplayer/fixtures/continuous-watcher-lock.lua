local s={}
s.__index=s
setmetatable(s,Card)
c13039848=s
function s.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
 e:SetCode(EVENT_CHAIN_SOLVED)
 e:SetRange(LOCATION_MZONE)
 e:SetOperation(function(e)
  -- The event opponent is known, but this watcher has no activated chain link.
  Duel.GetTurnPlayer()
  local lock=Effect.CreateEffect(e:GetHandler())
  lock:SetType(EFFECT_TYPE_FIELD)
  lock:SetCode(EFFECT_CANNOT_ATTACK)
  lock:SetRange(LOCATION_MZONE)
  lock:SetTargetRange(0,LOCATION_MZONE)
  e:GetHandler():RegisterEffect(lock)
 end)
 c:RegisterEffect(e)
end
