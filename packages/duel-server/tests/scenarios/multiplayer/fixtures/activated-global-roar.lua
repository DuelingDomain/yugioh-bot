-- No stock candidate creates its activated lock with GlobalEffect. This fixture
-- keeps Threatening Roar's real activation/lock. The equivalent own-turn
-- condition deliberately makes no opponent read that could hide bad metadata.
local s={}
s.__index=s
setmetatable(s,Card)
c36361633=s
function s.initial_effect(c)
  local e1=Effect.CreateEffect(c)
  e1:SetType(EFFECT_TYPE_ACTIVATE)
  e1:SetCode(EVENT_FREE_CHAIN)
  e1:SetHintTiming(0,TIMING_BATTLE_START)
  e1:SetCondition(s.condition)
  e1:SetOperation(s.activate)
  c:RegisterEffect(e1)
end
function s.condition(e,tp,eg,ep,ev,re,r,rp)
  local ph=Duel.GetCurrentPhase()
  return not Duel.IsTurnPlayer(tp) and ph&(PHASE_MAIN2|PHASE_END)==0
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
  local e1
  if ACTIVATED_GLOBAL_CLONE then
    -- Register a broad monitor first: its clone copies global_effect=true.
    local monitor=Effect.GlobalEffect()
    monitor:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
    monitor:SetCode(EVENT_ADJUST)
    monitor:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
    monitor:SetTargetRange(1,1)
    monitor:SetOperation(function() end)
    Duel.RegisterEffect(monitor,0)
    e1=monitor:Clone()
  else
    e1=Effect.GlobalEffect()
  end
  e1:SetType(EFFECT_TYPE_FIELD)
  e1:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)
  e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
  e1:SetReset(RESET_PHASE|PHASE_END)
  e1:SetTargetRange(0,1)
  Duel.RegisterEffect(e1,tp)
end
