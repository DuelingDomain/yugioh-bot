-- This fixture makes filter_inrange_cards reachable after a real control change.
-- Stock scripts only give ADD_EXTRA_TRIBUTE as a SINGLE effect or a face-up grant.
local s={}
s.__index=s
setmetatable(s,Card)
c13039848=s -- Giant Soldier of Stone; only this scenario uses this script table.
function s.initial_effect(c)
  local e0=Effect.CreateEffect(c)
  e0:SetType(EFFECT_TYPE_SINGLE)
  e0:SetCode(EFFECT_UNRELEASABLE_SUM)
  e0:SetValue(1)
  c:RegisterEffect(e0)
  local e1=Effect.CreateEffect(c)
  e1:SetType(EFFECT_TYPE_IGNITION)
  e1:SetRange(LOCATION_MZONE)
  e1:SetCountLimit(1)
  e1:SetTarget(s.target)
  e1:SetOperation(s.operation)
  c:RegisterEffect(e1)
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return Duel.IsExistingMatchingCard(nil,tp,0,LOCATION_MZONE,1,nil) end
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
  local c=e:GetHandler()
  local e1=Effect.CreateEffect(c)
  e1:SetType(EFFECT_TYPE_FIELD)
  e1:SetRange(LOCATION_MZONE)
  e1:SetCode(EFFECT_ADD_EXTRA_TRIBUTE)
  e1:SetTargetRange(LOCATION_HAND,LOCATION_MZONE)
  e1:SetValue(POS_FACEUP)
  e1:SetTarget(function(e,c) return c:IsControler(1-e:GetHandlerPlayer()) or c:IsLocation(LOCATION_HAND) end)
  c:RegisterEffect(e1)
end
