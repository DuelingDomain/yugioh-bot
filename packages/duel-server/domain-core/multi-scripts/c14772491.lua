if not aux.MPForEachController then return end
local mp_filter=s.filter
function s.filter(c)
 local result=false
 aux.MPForEachController(Group.FromCards(c),function(g,seat,p) result=mp_filter(c) end)
 return result
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
 local c=e:GetHandler()
 local tc=Duel.GetFirstTarget()
 if not tc or not c:IsRelateToEffect(e) or not tc:IsFaceup() or not tc:IsRelateToEffect(e) then return end
 local hand=Duel.GetFieldGroup(tp,LOCATION_HAND,0)
 local actor=Duel.MPActionSeat and Duel.MPActionSeat() or tp
 local candidates=Group.CreateGroup()
 aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
  if Duel.GetLocationCount(p,LOCATION_MZONE)>0 then
   candidates=hand:Filter(function(sc) return sc:IsSetCard(SET_NEO_SPACIAN) and sc:IsCanBeSpecialSummoned(e,0,actor,false,false,POS_FACEUP,p) end,nil)
  end
 end)
 if #candidates==0 then return end
 Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
 local sc=candidates:Select(tp,1,1,nil):GetFirst()
 if not sc then return end
 aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
  Duel.SpecialSummon(sc,0,actor,p,false,false,POS_FACEUP)
 end)
 c:SetCardTarget(tc)
 c:SetCardTarget(sc)
 e:GetLabelObject():SetLabelObject(sc)
 local e1=Effect.CreateEffect(c)
 e1:SetType(EFFECT_TYPE_SINGLE)
 e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE+EFFECT_FLAG_OWNER_RELATE)
 e1:SetRange(LOCATION_MZONE)
 e1:SetCode(EFFECT_UPDATE_ATTACK)
 e1:SetCondition(s.rcon)
 e1:SetValue(sc:GetAttack())
 e1:SetLabelObject(sc)
 e1:SetReset(RESET_EVENT|RESETS_STANDARD)
 tc:RegisterEffect(e1,true)
end
