if not aux.MPAny then return end
if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Heat Wave lasts until the activator's next Draw Phase. A removed seat's
-- skipped Draw Phase still expires the lock (Domain rulebook v1.4).
function s.operation(e,tp,eg,ep,ev,re,r,rp)
 local c=e:GetHandler()
 local lock=Effect.CreateEffect(c)
 lock:SetDescription(aux.Stringid(id,1))
 lock:SetType(EFFECT_TYPE_FIELD)
 lock:SetProperty(EFFECT_FLAG_PLAYER_TARGET|EFFECT_FLAG_CLIENT_HINT)
 lock:SetCode(EFFECT_CANNOT_SUMMON)
 lock:SetTargetRange(1,1)
 lock:SetTarget(s.sumlimit)
 lock:SetReset(RESET_PHASE|PHASE_DRAW|RESET_SELF_TURN)
 Duel.RegisterEffect(lock,tp)
 local special=lock:Clone()
 special:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
 Duel.RegisterEffect(special,tp)
 -- Expire at the start of a living activator's Draw Phase, before responses.
 -- The phase reset is also the expiry for a skipped removed-seat turn.
 local expiry=Effect.CreateEffect(c)
 expiry:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
 expiry:SetCode(EVENT_PHASE_START|PHASE_DRAW)
 expiry:SetCondition(function(e,tp) return Duel.IsTurnPlayer(tp) end)
 expiry:SetOperation(function(e) lock:Reset(); special:Reset(); e:Reset() end)
 expiry:SetReset(RESET_PHASE|PHASE_DRAW|RESET_SELF_TURN)
 Duel.RegisterEffect(expiry,tp)
end
