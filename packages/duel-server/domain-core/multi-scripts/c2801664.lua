if not aux.MPAny then return end
-- Ancient Warriors - Valiant Zhang De: the ignition condition asks if any one opponent controls more monsters.
-- The ATK value has no chain link, so no opponent is bound: FFA uses the opponent with the most monsters.
function s.atkcon(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0) end)()
		and Duel.IsAbleToEnterBP()
end
function s.val(e,c)
	local tp=c:GetControler()
	if Duel.MPMode()~=1 then return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)*300 end
	local ct=0
	for i=1,Duel.MPOppCount() do
		Duel.MPWindow(i)
		ct=math.max(ct,Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE))
		Duel.MPWindowEnd()
	end
	return ct*300
end
