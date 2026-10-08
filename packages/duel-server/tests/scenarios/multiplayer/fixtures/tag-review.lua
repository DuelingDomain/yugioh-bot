local s,id=GetID()
function s.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_ACTIVATE)
 e:SetCode(EVENT_FREE_CHAIN)
 e:SetOperation(s.operation)
 c:RegisterEffect(e)
 if id==95200160 then
  local capture=Effect.GlobalEffect()
  capture:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
  capture:SetCode(EVENT_STARTUP)
  capture:SetOperation(function()
   s.fields={}
   for seat=0,3 do s.fields[seat]=Duel.GetFieldCard(seat,LOCATION_SZONE,5) end
  end)
  Duel.RegisterEffect(capture,0)
  local watch=Effect.GlobalEffect()
  watch:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
  watch:SetCode(EVENT_TO_GRAVE)
  watch:SetOperation(function(e,tp,eg)
   for _,tc in pairs(s.fields) do
    assert(not eg:IsContains(tc),'moving a partner Field Spell must not send that card to the Graveyard')
   end
  end)
  Duel.RegisterEffect(watch,0)
 end
end
function s.operation(e,tp)
 local saved=Duel.MPSeatBinding()
 local own=aux.MPGeometrySeat()
 if id==95200160 then
  local tc=s.fields[own~2]
  assert(tc,'capture the partner Field Spell')
  assert(Duel.MoveToField(tc,tp,tp,LOCATION_FZONE,POS_FACEUP,true),'move the partner Field Spell')
  assert(Duel.MPSeatOf(tc)==own and tc:IsLocation(LOCATION_FZONE),'the moved Field Spell survives in the own Field Zone')
  Duel.Draw(tp,1,REASON_EFFECT)
  return
 end
 local facing=Duel.MPAcrossSeat(own)
 local non_facing=facing~2
 local first=id==95200158 and facing or non_facing
 local second=id==95200158 and non_facing or facing
 for _,seat in ipairs({first,second}) do
  assert(Duel.MPBindSeat(seat),'bind the exact opposing duelist')
  local free=seat==non_facing or id==95200159
  assert(Duel.CheckLocation(1-tp,LOCATION_MZONE,3)==free,'Crown disables only the facing column')
  assert(Duel.GetLocationCount(1-tp,LOCATION_MZONE)==(free and 5 or 4),'Crown zone count belongs to the exact opponent')
 end
 if saved==255 then Duel.MPBindSeat() else Duel.MPBindSeat(saved) end
 Duel.Draw(tp,1,REASON_EFFECT)
end
