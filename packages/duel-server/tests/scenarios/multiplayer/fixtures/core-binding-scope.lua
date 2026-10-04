-- Direct proofs of the core binding rules. No production card script changes.
local s={}
s.__index=s
setmetatable(s,Card)
c13039848=s
function s.initial_effect(c)
  local e=Effect.CreateEffect(c)
  e:SetRange(LOCATION_MZONE)
  if CORE_CASE=="phase-read" or CORE_CASE=="phase-later" or CORE_CASE=="phase-same-turn" then
    e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_TRIGGER_F)
    e:SetCode(EVENT_PHASE|PHASE_STANDBY)
    e:SetCountLimit(CORE_CASE=="phase-same-turn" and 2 or 1)
    e:SetCondition(function(e,tp)
      if Duel.GetTurnCount()<2 or (CORE_CASE=="phase-same-turn" and e:GetLabel()==2) then return false end
      if CORE_CASE=="phase-same-turn" and e:GetLabel()==0 then return Duel.IsTurnPlayer(1-tp) end
      if CORE_CASE=="phase-read" then local unused=Duel.GetTurnPlayer() end
      if CORE_CASE=="phase-later" and Duel.GetTurnCount()==2 then return Duel.IsTurnPlayer(1-tp) end
      return true
    end)
    e:SetOperation(function(e,tp)
      Duel.Recover(1-tp,100,REASON_EFFECT)
      if CORE_CASE=="phase-same-turn" then e:SetLabel(e:GetLabel()+1) end
    end)
  elseif CORE_CASE=="tag-read" then
    e:SetType(EFFECT_TYPE_IGNITION)
    e:SetOperation(function(e,tp)
      local n=Duel.GetFieldGroupCount(1-tp,LOCATION_HAND,0)
      Duel.Draw(1-tp,1,REASON_EFFECT)
    end)
  else
    e:SetType(EFFECT_TYPE_IGNITION)
    e:SetCountLimit(1)
    e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
      if chk==0 then return Duel.IsExistingMatchingCard(nil,tp,0,LOCATION_MZONE,1,nil) end
    end)
    e:SetOperation(function(e,tp)
      local c=e:GetHandler()
      if CORE_CASE=="empty-duration" then Duel.MPBindSeat(-1) end
      local lock=Effect.CreateEffect(c)
      lock:SetCode(EFFECT_UPDATE_ATTACK)
      lock:SetValue(700)
      if CORE_CASE=="single" then
        lock:SetType(EFFECT_TYPE_SINGLE)
      elseif CORE_CASE=="equip" then
        lock:SetType(EFFECT_TYPE_EQUIP)
      else
        lock:SetType(EFFECT_TYPE_FIELD)
        if CORE_CASE=="field" or CORE_CASE=="card-lock" or CORE_CASE=="card-lock-symbolic" or CORE_CASE=="player-lock" then lock:SetRange(CORE_CASE=="card-lock-symbolic" and LOCATION_MMZONE or LOCATION_MZONE) end
        local own_duration=CORE_CASE=="field" or CORE_CASE=="duration" or CORE_CASE=="dead-duration" or CORE_CASE=="empty-duration"
        lock:SetTargetRange(own_duration and LOCATION_MZONE or 0,own_duration and 0 or LOCATION_MZONE)
      end
      if CORE_CASE=="card-lock" or CORE_CASE=="card-lock-symbolic" or CORE_CASE=="player-lock" then
        local stop=Effect.CreateEffect(c)
        stop:SetType(EFFECT_TYPE_FIELD)
        stop:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
        stop:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        stop:SetTargetRange(0,1)
        -- Duel.RegisterEffect keeps FIELD_ONLY even with a range; it still binds the player.
        stop:SetRange(CORE_CASE=="card-lock-symbolic" and LOCATION_MMZONE or LOCATION_MZONE)
        if CORE_CASE=="player-lock" then
          stop:SetReset(RESET_PHASE|PHASE_END,6)
          Duel.RegisterEffect(stop,tp)
          lock:SetReset(RESET_PHASE|PHASE_END,6)
          Duel.RegisterEffect(lock,tp)
        else c:RegisterEffect(stop);c:RegisterEffect(lock) end
      else
        lock:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN)
        if CORE_CASE=="duration" or CORE_CASE=="dead-duration" or CORE_CASE=="empty-duration" then Duel.RegisterEffect(lock,tp)
        else
          c:RegisterEffect(lock)
          if CORE_CASE=="equip" then
            local limit=Effect.CreateEffect(c)
            limit:SetType(EFFECT_TYPE_SINGLE)
            limit:SetCode(EFFECT_EQUIP_LIMIT)
            limit:SetValue(1)
            c:RegisterEffect(limit)
            local target=Duel.GetFirstMatchingCard(nil,tp,LOCATION_MZONE,0,c)
            Duel.Equip(tp,c,target,true)
          end
        end
        if CORE_CASE=="dead-duration" then Duel.Damage(1-tp,8000,REASON_EFFECT) end
      end
    end)
  end
  c:RegisterEffect(e)
end
