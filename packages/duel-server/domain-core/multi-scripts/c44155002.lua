-- The Fabled Unicore: Q2 compares the combined opposing hands in Tag.
if Duel.MPMode()~=2 then return end
local function mp_opposing_hand_count(tp)
	local me=aux.MPKey(tp)
	local ct=0
	aux.MPForEachDuelist(function(p,seat)
		if aux.MPKeyOfSeat(seat)~=me then ct=ct+Duel.GetFieldGroupCount(p,LOCATION_HAND,0) end
	end)
	return ct
end
function s.disop(e,tp,eg,ep,ev,re,r,rp)
	if ep==tp or Duel.GetFieldGroupCount(tp,LOCATION_HAND,0)~=mp_opposing_hand_count(tp) then return end
	local rc=re:GetHandler()
	if Duel.NegateEffect(ev) and rc:IsRelateToEffect(re) then Duel.Destroy(rc,REASON_EFFECT) end
end
