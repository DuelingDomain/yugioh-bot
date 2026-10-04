-- FFA4: keep every Link mask in the acting seat's physical view.
local mp_spcon=s.spcon
function s.spcon(e,tp,eg,ep,ev,re,r,rp)
 if not aux.MPGeometryShared() then return mp_spcon(e,tp,eg,ep,ev,re,r,rp) end
 local zone=0
 local lg=Duel.GetMatchingGroup(function(tc) return s.lkfilter(tc) and tc:IsAcross(tp) end,tp,0,LOCATION_MZONE,nil)
 for tc in aux.Next(lg) do zone=zone|aux.MPGeometryLinkedZone(tc,tp) end
 return not eg:IsContains(e:GetHandler()) and eg:IsExists(function(tc)
  if not tc:IsControler(tp) and not tc:IsAcross(tp) then return false end
  local seq=tc:GetSequence()
  if not tc:IsControler(tp) then seq=seq+16 end
  return bit.extract(zone,seq)~=0
 end,1,nil)
end
