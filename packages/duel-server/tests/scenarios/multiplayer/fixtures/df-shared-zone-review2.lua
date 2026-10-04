-- Real activation probes for the second shared-zone review.
local s,id=GetID()
function s.initial_effect(c)
 local capture=Effect.GlobalEffect()
 capture:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
 capture:SetCode(EVENT_STARTUP)
 capture:SetOperation(function()
  local foreign=id>=95200149
  local seat=foreign and ((id-95200149)%3+1) or ((id==95200143 or id==95200147) and 1 or 2)
  s.link=Duel.GetFieldCard(foreign and 1 or 0,LOCATION_MZONE,5) or Duel.GetFieldCard(1,LOCATION_MZONE,2)
  s.card=Duel.GetFieldCard(seat,LOCATION_MZONE,foreign and seat==2 and s.link:GetOriginalCode()==95372220 and 6 or (foreign and (seat==3 and 3 or 1) or 3))
 end)
 Duel.RegisterEffect(capture,0)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_ACTIVATE)
 e:SetCode(EVENT_FREE_CHAIN)
 if id==95200145 or id==95200146 then
  e:SetProperty(EFFECT_FLAG_CARD_TARGET)
  e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
   local zone=id==95200145 and s.link:GetLinkedZone() or s.link:GetColumnZone(LOCATION_MZONE)
   if chk==0 then return (zone&0xffff0000)~=0 end
   assert(Duel.MPSeat(1-tp)==2,'own-view geometry cost binds the across seat')
   Duel.PayLPCost(tp,500)
  end)
  e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
   if chkc then return chkc:IsControler(1-tp) and chkc:IsLocation(LOCATION_MZONE) end
   if chk==0 then return Duel.IsExistingTarget(Card.IsMonster,tp,0,LOCATION_MZONE,1,nil) end
   Duel.SelectTarget(tp,Card.IsMonster,tp,0,LOCATION_MZONE,1,1,nil)
  end)
  e:SetOperation(function(e,tp)
   assert(Duel.MPSeat(1-tp)==2,'the later target keeps one declared opponent')
   Duel.Destroy(Duel.GetTargetCards(e),REASON_EFFECT)
  end)
 else
  e:SetOperation(function(e,tp)
   local foreign=id>=95200149
   local seat=foreign and ((id-95200149)%3+1) or ((id==95200143 or id==95200147) and 1 or 2)
   Duel.MPBindSeat(seat)
   Duel.SendtoGrave(s.card,REASON_EFFECT)
   Duel.MPBindSeat()
   local utility=id==95200147 or id==95200148 or id>=95200152
   local filter=utility and aux.zptfilter or _G['c'..s.link:GetOriginalCode()].cfilter
   local expected=foreign and (seat==3 or (seat==1 and s.link:GetOriginalCode()~=95372220)) or (not foreign and seat==2)
   assert(filter(s.card,s.link)==expected,'the official previous-controller filter uses exact own and across seats')
   Duel.Draw(tp,1,REASON_EFFECT)
  end)
 end
 c:RegisterEffect(e)
end
