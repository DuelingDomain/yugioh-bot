-- Use a real activation and player-effect callback to test core-fix5 patch 03.
local s={}
s.__index=s
setmetatable(s,Card)
c13039848=s
function s.initial_effect(c)
  local e=Effect.CreateEffect(c)
  e:SetType(EFFECT_TYPE_IGNITION)
  e:SetRange(LOCATION_MZONE)
  e:SetCountLimit(1)
  e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
    if chk==0 then return Duel.IsExistingMatchingCard(nil,tp,0,LOCATION_MZONE,1,nil) end
  end)
  e:SetOperation(function(e,tp)
    if TURN_CASE=="empty" then Duel.MPBindSeat(-1) end
    local duration=Effect.CreateEffect(c)
    duration:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
    duration:SetCode(EVENT_PHASE|PHASE_STANDBY)
    duration:SetCountLimit(1)
    duration:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN,6)
    duration:SetCondition(function(e,tp) return Duel.IsTurnPlayer(1-tp) end)
    duration:SetOperation(function(e,tp) Duel.Recover(tp,100,REASON_EFFECT) end)
    if TURN_CASE=="card" then
      duration:SetRange(LOCATION_MZONE)
      c:RegisterEffect(duration)
    else
      Duel.RegisterEffect(duration,tp)
    end
    if TURN_CASE=="dead" then Duel.Damage(1-tp,8000,REASON_EFFECT) end
  end)
  c:RegisterEffect(e)
end
