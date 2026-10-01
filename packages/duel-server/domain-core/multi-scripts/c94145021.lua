if not aux.MPKey then return end
-- Droll & Lock Bird: the global check names the duelists that added a card from the Deck to the hand, and the hand effect asks if
-- any duelist other than its own side did. The stock check compares the controller with the literals 0 and 1 and gives 0, 1 or
-- "both" as the event value, so a card added at seat 2 or 3 raised no event. The global effect sees the real seats (core patch 0053),
-- so it writes one bit per key (FFA the seat, Tag the team: aux.MPKey) in the event value, and the holder compares it with its own key.
function s.regcon(e,tp,eg,ep,ev,re,r,rp)
	if Duel.IsPhase(PHASE_DRAW) or Duel.IsPhase(PHASE_DAMAGE) then return false end
	local v=0
	for tc in eg:Iter() do
		if tc:IsPreviousLocation(LOCATION_DECK) then v=v|(1<<aux.MPKey(tc:GetControler())) end
	end
	if v==0 then return false end
	e:SetLabel(v)
	return true
end
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return (ev&~(1<<aux.MPKey(0)))~=0
end
