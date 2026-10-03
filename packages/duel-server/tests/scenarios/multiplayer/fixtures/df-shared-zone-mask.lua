-- Register a zone effect with an opponent declared in a real activation.
-- Across geometry proofs declare the across seat; numeric controls use a side seat.
local s,id=GetID()
function s.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_ACTIVATE)
 e:SetCode(EVENT_FREE_CHAIN)
 e:SetTarget(aux.MPTarget(s.target))
 e:SetOperation(s.operation)
 c:RegisterEffect(e)
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
 if chk==0 then return Duel.GetLP(1-tp)>0 end
 Duel.SetTargetPlayer(1-tp)
end
function s.operation(e,tp)
 local c=e:GetHandler()
 local ze=Effect.CreateEffect(c)
 ze:SetType(EFFECT_TYPE_FIELD)
 ze:SetCode(id==95200130 and EFFECT_BECOME_LINKED_ZONE or EFFECT_DISABLE_FIELD)
 ze:SetRange(LOCATION_SZONE)
 if id==95200122 or id==95200130 then
  ze:SetValue(function(e) return e:GetHandler():GetColumnZone(LOCATION_MZONE) end)
 elseif id==95200123 then
  ze:SetOperation(function(e) return e:GetHandler():GetColumnZone(LOCATION_MZONE) end)
 elseif id==95200124 then
  -- An unrelated prior geometry query must not change this numeric bound mask.
  c:GetColumnZone(LOCATION_MZONE)
  ze:SetValue(1<<(16+3))
 elseif id==95200125 then
  -- A numeric zone prompt has an explicit target.
  ze:SetValue(Duel.SelectDisableField(tp,1,0,LOCATION_MZONE,0))
 elseif id==95200126 then
  -- Static Lua integers have no origin. This preserves the explicit contract:
  -- this number binds to p1, even though it was read from p0/p2 geometry.
  Duel.MPBindSeat(2)
  local saved=c:GetColumnZone(LOCATION_MZONE)
  Duel.MPBindSeat()
  ze:SetValue(saved)
 elseif id==95200132 then
  local selected=Duel.SelectDisableField(tp,1,0,LOCATION_MZONE,0)
  ze:SetValue(function(e)
   e:GetHandler():GetColumnZone(LOCATION_MZONE)
   return selected
  end)
 elseif id==95200127 then
  ze:SetCondition(function(e) return e:GetHandler():GetColumnZone(LOCATION_MZONE)~=0 end)
  ze:SetValue(1<<(16+3))
 elseif id==95200128 then
  ze:SetValue(function(e)
   if c:GetFlagEffect(id)==0 then return c:GetColumnZone(LOCATION_MZONE) end
   return 1<<(16+3)
  end)
 elseif id==95200129 then
  ze:SetProperty(EFFECT_FLAG_REPEAT)
  ze:SetOperation(function(e,tp)
   if c:GetFlagEffect(id)~=0 then return c:GetColumnZone(LOCATION_MZONE) end
   Duel.MPBindSeat(1)
   c:GetColumnZone(LOCATION_MZONE)
   if e:GetLabel()~=0 then return e:GetLabel() end
   local z=Duel.SelectDisableField(tp,1,0,LOCATION_MZONE,0)
   e:SetLabel(z)
   return z
  end)
 end
 if id==95200128 or id==95200129 then
  local switch=Effect.CreateEffect(c)
  switch:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
  switch:SetCode(EVENT_SUMMON_SUCCESS)
  switch:SetRange(LOCATION_SZONE)
  switch:SetOperation(function() c:RegisterFlagEffect(id,0,0,1) end)
  c:RegisterEffect(switch)
 end
 c:RegisterEffect(ze)
 Duel.Draw(tp,1,REASON_EFFECT)
end
