-- Test fixture: read the four opponent Card zone masks in a real activation cost.
-- Capture the cards in a global Startup effect, so the cost has no other player read.
local s,id=GetID()
function s.initial_effect(c)
 local e1=Effect.CreateEffect(c)
 e1:SetType(EFFECT_TYPE_ACTIVATE)
 e1:SetCode(EVENT_FREE_CHAIN)
 e1:SetCost(s.cost)
 c:RegisterEffect(e1)
 local e2=Effect.CreateEffect(c)
 e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
 e2:SetCode(EVENT_STARTUP)
 e2:SetOperation(function()
  s.links={}
  for p=1,3 do
   local link=Duel.GetFieldCard(p,LOCATION_MZONE,5)
   if link then s.links[#s.links+1]=link end
  end
 end)
 Duel.RegisterEffect(e2,0)
end
function s.cost(e,tp,eg,ep,ev,re,r,rp,chk)
 assert(s.expected_count and #s.links==s.expected_count,'opponent Link capture count changed')
 for _,c in ipairs(s.links) do
  local linked=c:GetLinkedZone(1-tp)
  local free=c:GetFreeLinkedZone(1-tp)
  local mutual=c:GetMutualLinkedZone(1-tp)
  local column=c:GetColumnZone(LOCATION_MZONE,0,0,1-tp)
  if chk~=0 then
   assert(linked==(s.expected_count==3 and 0x80007 or 7),'opponent Link zone changed')
   assert(free==(s.expected_count==3 and 0x80005 or 5),'opponent free Link zone changed')
   assert(mutual==2,'opponent mutual Link zone changed')
   assert(column==(s.expected_count==3 and 0x80002 or 2),'opponent column zone changed')
  end
 end
 if chk==0 then return true end
 Duel.PayLPCost(tp,500)
end
