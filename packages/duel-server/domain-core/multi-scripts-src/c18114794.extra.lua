-- stock: s[2] holds the turn number of the counts, and a count per player 0 and 1. The count of the turn player is kept per key (seat in FFA,
-- team in Tag) and the turn number in s.mp_turn.
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	local turnp=Duel.GetTurnPlayer()
	if Duel.GetTurnCount()~=s.mp_turn then
		s.mp_reset_all()
		s.mp_turn=Duel.GetTurnCount()
	end
	local p1=false
	for tc in aux.Next(eg) do
		if tc:GetSummonPlayer()==turnp then p1=true end
	end
	if p1 then
		s[turnp]=s[turnp]+1
		if s[turnp]==3 then
			Duel.RaiseEvent(e:GetHandler(),EVENT_CUSTOM+id,e,0,0,0,0)
		end
	end
end
