if not aux.MPKey then return end
-- The global destroy event has real owner seats. Give each owner a separate event.
function s.check(e,tp,eg,ep,ev,re,r,rp)
	if Duel.GetCurrentPhase()~=PHASE_END then return end
	local groups={}
	for tc in aux.Next(eg) do
		if tc:IsFaceup() and tc:IsLocation(LOCATION_MZONE) and tc:IsSetCard(SET_KOAKI_MEIRU) then
			local owner=tc:GetOwner()
			if not groups[owner] then groups[owner]=Group.CreateGroup() end
			groups[owner]:AddCard(tc)
		end
	end
	for owner=0,3 do
		local g=groups[owner]
		if g and #g>0 then Duel.RaiseEvent(g,EVENT_CUSTOM+id,re,r,rp,owner,0) end
	end
end
