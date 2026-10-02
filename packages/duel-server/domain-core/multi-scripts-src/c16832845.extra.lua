-- stock: s[0] and s[1] (own side and "the" opponent). The check writes the flag for the real controller seat; the condition asks if
-- the own side and at least one opponent side had a monster destroyed.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	if not s[0] then return false end
	local own=aux.MPKey(tp)
	for seat=0,3 do
		if aux.MPKeyOfSeat(seat)~=own and s.mp_slot(s,seat) then return true end
	end
	return false
end
