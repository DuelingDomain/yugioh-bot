-- Mark each affected seat once after the real Ogre lock is registered.
local done=false
local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_CHAIN_SOLVED)
e:SetOperation(function()
 if done then return end
 local affected={}
 for i=0,FIXTURE_SEAT_COUNT-1 do
  local c=Duel.GetFieldCard(i,LOCATION_MZONE,0)
  if c and c:IsHasEffect(EFFECT_CANNOT_SELECT_BATTLE_TARGET) then affected[#affected+1]=i end
 end
 if #affected==0 then return end
 done=true
 for _,i in ipairs(affected) do
  Duel.SetLP(i,Duel.GetLP(i)-100)
 end
end)
Duel.RegisterEffect(e,0)
