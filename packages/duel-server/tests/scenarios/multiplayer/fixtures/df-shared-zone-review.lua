-- Real Spell actions. The official Link cards keep their full scripts.
local s,id=GetID()
function s.initial_effect(c)
 local capture=Effect.GlobalEffect()
 capture:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
 capture:SetCode(EVENT_STARTUP)
 capture:SetOperation(function()
  s.cards={}
  for p=0,3 do for seq=0,6 do
   local tc=Duel.GetFieldCard(p,LOCATION_MZONE,seq)
   if tc then s.cards[p*8+seq]=tc end
  end end
  -- Keep Enemy Controller's one legal target identical with and without C3.
  if id==95200141 then
   local protect=Effect.CreateEffect(s.cards[1])
   protect:SetType(EFFECT_TYPE_SINGLE)
   protect:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
   protect:SetValue(1)
   s.cards[1]:RegisterEffect(protect)
  end
 end)
 Duel.RegisterEffect(capture,0)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_ACTIVATE)
 e:SetCode(EVENT_FREE_CHAIN)
 if id==95200142 then e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
  Duel.MPBindSeat()
  local linked=Duel.GetLinkedZone(tp)
  if chk==0 and linked~=0x80007 then return false end
  assert(linked==0x80007 and Duel.MPSeat(1-tp)==1,'Duel own Link high half binds across silently')
  assert(Duel.GetLinkedZone(1-tp)==0x70008,'Duel across Link high half')
  Duel.MPBindSeat()
  assert(Duel.GetFreeLinkedZone(tp)==0x80007 and Duel.MPSeat(1-tp)==1,'Duel own free Link high half binds across silently')
  assert(Duel.GetFreeLinkedZone(1-tp)==0x70008,'Duel across free Link high half')
  Duel.MPBindSeat(2)
  assert(Duel.GetLinkedZone(tp)==7 and Duel.GetFreeLinkedZone(tp)==7,'Duel own Link masks clear the high half for a side binding')
  assert(Duel.GetLinkedZone(1-tp)==7 and Duel.GetFreeLinkedZone(1-tp)==7,'Duel side masks keep only their local low half')
  Duel.MPBindSeat(1)
  assert(Duel.GetLinkedZone(tp)==0x80007 and Duel.GetFreeLinkedZone(tp)==0x80007,'Duel across binding restores own masks')
  assert(Duel.GetLinkedZone(1-tp)==0x70008 and Duel.GetFreeLinkedZone(1-tp)==0x70008,'Duel across binding restores mirrored masks')
  Duel.MPBindSeat()
  if chk==0 then return true end
  Duel.PayLPCost(tp,500)
 end) end
 if id==95200139 then e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
  local c=s.cards[5]
  local linked=c:GetLinkedZone()
  if chk==0 and linked~=0x80007 then return false end
  assert(linked==0x80007 and Duel.MPSeat(1-tp)==1,'unbound high half binds across without a prompt')
  assert(c:GetLinkedZone(1-tp)==0x70008,'across bound Link read')
  assert(c:GetFreeLinkedZone(1-tp)==0x50000,'across bound free Link read')
  assert(c:GetMutualLinkedZone(1-tp)==0x20008,'across bound mutual Link read')
  assert(c:GetColumnZone(LOCATION_MZONE,0,0,1-tp)==0x20008,'across bound column read')
  Duel.MPBindSeat(2)
  assert(c:GetLinkedZone(1-tp)==0 and c:GetFreeLinkedZone(1-tp)==0,'side bound Link reads are empty')
  assert(c:GetMutualLinkedZone(1-tp)==0 and c:GetColumnZone(LOCATION_MZONE,0,0,1-tp)==0,'side bound mutual and column reads are empty')
  assert(c:GetLinkedZone()>>16==0 and c:GetFreeLinkedZone()>>16==0,'side bound default Link reads have no high half')
  assert(c:GetMutualLinkedZone(tp)>>16==0 and c:GetColumnZone(LOCATION_MZONE,0,0,tp)>>16==0,'side bound own reads have no high half')
  assert(s.cards[11]:GetLinkedZone(tp)>>16==0,'across card cannot expose a high half for a side binding')
  assert(aux.MPGeometryLinkedZone(c)==0x80007 and Duel.MPSeat(1-tp)==2,'trigger geometry preserves a side-seat event binding')
  Duel.MPBindSeat(1)
  assert(c:GetLinkedZone()==0x80007 and c:GetLinkedZone(1-tp)==0x70008,'across binding restores masks')
  assert(s.cards[11]:GetLinkedZone(tp)~=0,'across card read is restored')
  Duel.MPBindSeat()
  local was_bound=Duel.MPBound()
  for _,cp in ipairs({PLAYER_NONE,PLAYER_ALL,7,255}) do
   assert(c:GetLinkedZone(cp)==0 and c:GetFreeLinkedZone(cp)==0,'invalid Link views are empty')
   assert(c:GetMutualLinkedZone(cp)==0 and c:GetColumnZone(LOCATION_MZONE,0,0,cp)==0,'invalid mutual and column views are empty')
  end
  assert(Duel.MPBound()==was_bound,'invalid viewers do not bind a seat')
  if chk==0 then return true end
  Duel.PayLPCost(tp,500)
 end) end
 if id==95200138 then e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
  assert(not Duel.CheckLocation(tp,LOCATION_MZONE,5),'living across card must block EMZ 5 before surrender')
  if chk==0 then return true end
 end) end
 e:SetOperation(function(e,tp)
  if id==95200137 then
   local c=s.cards[0]
   assert(Card.GetToBeLinkedZone(s.cards[21],c,tp,false,false)==0,'side seat must give no future linked zone')
   assert(Card.GetToBeLinkedZone(s.cards[13],c,tp,false,false)~=0,'across seat must give a future linked zone')
   Duel.Draw(tp,1,REASON_EFFECT)
  elseif id==95200138 or id==95200139 or id==95200142 then Duel.Draw(tp,1,REASON_EFFECT)
  elseif id==95200140 then Duel.Destroy(s.cards[11],REASON_EFFECT)
  else
   local g=Group.CreateGroup()
   if id~=95200135 then g:AddCard(s.cards[11]) end
   if id~=95200134 then g:AddCard(s.cards[19]) end
   Duel.Destroy(g,REASON_EFFECT)
  end
 end)
 c:RegisterEffect(e)
end
