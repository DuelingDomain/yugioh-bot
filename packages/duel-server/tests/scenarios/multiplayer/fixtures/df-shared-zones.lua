-- Capture real cards at Startup. Read geometry during a real Spell cost.
local s,id=GetID()
function s.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_ACTIVATE)
 e:SetCode(EVENT_FREE_CHAIN)
 e:SetCost(s.cost)
 e:SetOperation(function(e,tp) Duel.Draw(tp,1,REASON_EFFECT) end)
 c:RegisterEffect(e)
 local capture=Effect.GlobalEffect()
 capture:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
 capture:SetCode(EVENT_STARTUP)
 capture:SetOperation(function()
  s.cards={}
  for p=0,3 do
   for seq=0,6 do
    local tc=Duel.GetFieldCard(p,LOCATION_MZONE,seq)
    if tc then s.cards[#s.cards+1]=tc end
   end
  end
 end)
 Duel.RegisterEffect(capture,0)
end
function s.cost(e,tp,eg,ep,ev,re,r,rp,chk)
 if id==95200131 or id==95200133 then
  local c
  for _,tc in ipairs(s.cards) do
   if tc:IsCode(31226177) and tc:GetSequence()==5 then c=tc end
  end
  assert(c and c:IsExtraLinked()==(id==95200131),'Extra Link uses only the across field')
  if chk==0 then return true end
  Duel.PayLPCost(tp,500)
  return
 end
 local c
 for _,tc in ipairs(s.cards) do if tc:IsCode(74997493) then c=tc end end
 assert(c,'Saryuja was not captured')
 local shared=id==95200120
 local linked=shared and 0x80007 or 7
 local mutual=shared and 0x80002 or 2
 local column=shared and 0x80002 or 2
 if chk==0 and c:GetLinkedZone()~=linked then return false end
 assert(c:GetLinkedZone()==linked,'across Link mask')
 assert(c:GetFreeLinkedZone()==5,'free Link mask excludes occupied across zone')
 assert(c:GetMutualLinkedZone()==mutual,'across mutual Link mask')
 assert(c:GetColumnZone(LOCATION_MZONE)==column,'across column mask')
 assert(c:GetLinkedZone(tp)==linked,'own Link viewer')
 assert(c:GetColumnZone(LOCATION_MZONE,0,0,tp)==column,'own column viewer')
 if shared then
  assert(c:GetFreeLinkedZone(1-tp)==0x50000,'across free Link viewer')
  assert(c:GetLinkedZone(1-tp)==0x70008,'across Link viewer')
  assert(c:GetMutualLinkedZone(1-tp)==0x20008,'across mutual viewer')
  assert(c:GetColumnZone(LOCATION_MZONE,0,0,1-tp)==0x20008,'across column viewer')
 end
 assert(c:GetLinkedGroupCount()==(shared and 2 or 1),'across linked group')
 assert(c:GetMutualLinkedGroupCount()==(shared and 2 or 1),'across mutual group')
 assert(c:GetColumnGroupCount()==(shared and 3 or 1),'across column group')
 if shared then
  assert(Duel.GetLinkedGroupCount(tp,LOCATION_MZONE,LOCATION_MZONE)==3,'field linked group includes across')
  assert(#Duel.GetLinkedGroup(tp,LOCATION_MZONE,LOCATION_MZONE)==3,'field linked group size')
 end
 if chk==0 then return true end
 Duel.PayLPCost(tp,500)
end
