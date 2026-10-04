-- Processor fixtures only: the unusual event activations, BOTH_SIDE quick effect,
-- and two hand-Trap permissions make otherwise rare AddChain branches reproducible.
local s,id=GetID()
function s.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetDescription(aux.Stringid(id,0))
 e:SetCode(EVENT_CUSTOM+84)
 if id==95200844 then
  e:SetType(EFFECT_TYPE_QUICK_O)
  e:SetRange(LOCATION_MZONE)
  e:SetProperty(EFFECT_FLAG_BOTH_SIDE)
  e:SetCondition(function(e,tp) return Duel.MPSeat(tp)==1 end)
 else
  e:SetType(EFFECT_TYPE_ACTIVATE)
 end
 e:SetCountLimit(1,id)
 e:SetCost(s.cost)
 e:SetTarget(s.target)
 e:SetOperation(s.operation)
 c:RegisterEffect(e)
 QueuedReviewEffects=QueuedReviewEffects or {}
 QueuedReviewEffects[id]=e
 -- A Continuous Spell needs a quick-activation permission for an event response.
 -- Its printed type stays TYPE_SPELL|TYPE_CONTINUOUS throughout the scenario.
 if id==95200842 then
  local quick=Effect.CreateEffect(c)
  quick:SetType(EFFECT_TYPE_SINGLE)
  quick:SetCode(EFFECT_BECOME_QUICK)
  c:RegisterEffect(quick)
 end
 if id==95200843 then
  for i=1,2 do
   local permission=Effect.CreateEffect(c)
   permission:SetDescription(aux.Stringid(id,i))
   permission:SetType(EFFECT_TYPE_SINGLE)
   permission:SetCode(EFFECT_TRAP_ACT_IN_HAND)
   permission:SetCountLimit(1,id+i)
   permission:SetValue(function()
    BoundReview.permissions=BoundReview.permissions+1
    return true
   end)
   c:RegisterEffect(permission)
  end
 end
 if id~=95200844 then
  local bonus=Effect.CreateEffect(c)
  bonus:SetType(EFFECT_TYPE_FIELD)
  bonus:SetCode(EFFECT_UPDATE_ATTACK)
  bonus:SetRange(LOCATION_SZONE)
  bonus:SetTargetRange(LOCATION_MZONE,0)
  bonus:SetValue(500)
  c:RegisterEffect(bonus)
 end
end
function s.available(tp)
 return Duel.GetFieldGroupCount(1-tp,LOCATION_HAND,0)>0
end
function s.cost(e,tp,eg,ep,ev,re,r,rp,chk)
 if chk==0 then return s.available(tp) end
 BoundReview.costs=BoundReview.costs+1
 assert(s.available(tp),'departed causal opponent reached cost callback')
 if BoundReview.cost_prompt then Duel.SelectOption(tp,aux.Stringid(id,3),aux.Stringid(id,4)) end
 Duel.PayLPCost(tp,100)
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
 if chk==0 then return s.available(tp) end
 BoundReview.targets=BoundReview.targets+1
 assert(s.available(tp),'departed causal opponent reached target callback')
 if id==95200844 then
  assert(Duel.MPSeat(1-tp)==0,'controller capture survived actual activator team mismatch')
 end
 Duel.SetTargetPlayer(1-tp)
end
function s.operation(e,tp)
 BoundReview.operations=BoundReview.operations+1
 if not s.available(tp) then return end
 local recipient=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)
 Duel.Damage(recipient,777,REASON_EFFECT)
 Duel.Recover(tp,123,REASON_EFFECT)
end
