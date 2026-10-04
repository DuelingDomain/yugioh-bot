-- This test script adds effects to Giant Soldier of Stone.
local s={}
s.__index=s
setmetatable(s,Card)
c13039848=s
local saved
function s.lock(c,value)
  local e=Effect.CreateEffect(c)
  e:SetType(EFFECT_TYPE_FIELD)
  e:SetRange(LOCATION_MZONE)
  e:SetCode(EFFECT_UPDATE_ATTACK)
  e:SetTargetRange(0,LOCATION_MZONE)
  e:SetValue(value)
  return e
end
function s.initial_effect(c)
  local e=Effect.CreateEffect(c)
  e:SetType(EFFECT_TYPE_IGNITION)
  e:SetRange(LOCATION_MZONE)
  e:SetCountLimit(1)
  if FIX3_CASE~="turn-read" then e:SetTarget(s.target) end
  e:SetOperation(FIX3_CASE=="turn-read" and s.turn_read or s.operation)
  c:RegisterEffect(e)
  if FIX3_CASE=="clone" then
    local watcher=Effect.CreateEffect(c)
    watcher:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
    watcher:SetCode(EVENT_PHASE|PHASE_END)
    watcher:SetRange(LOCATION_MZONE)
    watcher:SetCountLimit(1)
    watcher:SetOperation(function(e)
      if not saved then return end
      local copy=saved:Clone()
      saved:Reset()
      copy:SetValue(700)
      e:GetHandler():RegisterEffect(copy)
      saved=nil
    end)
    c:RegisterEffect(watcher)
  end
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return Duel.IsExistingMatchingCard(nil,tp,0,LOCATION_MZONE,1,nil) end
end
function s.operation(e,tp)
  local c=e:GetHandler()
  if FIX3_CASE=="delayed" then
    local delayed=Effect.CreateEffect(c)
    delayed:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
    delayed:SetCode(EVENT_PHASE|PHASE_END)
    delayed:SetCountLimit(1)
    delayed:SetReset(RESET_PHASE|PHASE_END)
    delayed:SetOperation(function(e,tp)
      local count=Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)
      if count>0 then e:GetOwner():RegisterEffect(s.lock(e:GetOwner(),700)) end
    end)
    Duel.RegisterEffect(delayed,tp)
  else
    saved=s.lock(c,FIX3_CASE=="clone" and 100 or 700)
    c:RegisterEffect(saved)
  end
end
function s.turn_read(e,tp)
  local turn=Duel.GetTurnPlayer()
  local count=Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)
  if count>0 then Duel.Recover(1-tp,100,REASON_EFFECT) end
  e:GetHandler():RegisterEffect(s.lock(e:GetHandler(),700))
end
