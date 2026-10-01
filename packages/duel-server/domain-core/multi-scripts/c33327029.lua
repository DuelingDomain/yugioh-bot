if not aux.MPKey then return end
-- Metalfoes Counter: the global check raises the event with the value 0, 1 or PLAYER_ALL for the players 0 and 1; the handler asks
-- ev==tp or ev==PLAYER_ALL. The value is a bit mask of the keys of the duelists that lost a card (aux.MPKey: FFA the seat, Tag the team),
-- and the holder asks for its own key.
function s.regcon(e,tp,eg,ep,ev,re,r,rp)
	local v=0
	for seat=0,3 do
		if eg:IsExists(s.cfilter,1,nil,seat) then v=v|(1<<aux.MPKey(seat)) end
	end
	if v==0 then return false end
	e:SetLabel(v)
	return true
end
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return (ev&(1<<aux.MPKey(tp)))~=0
end
