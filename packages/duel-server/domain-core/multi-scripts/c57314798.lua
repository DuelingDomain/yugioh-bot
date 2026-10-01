if not aux.MPAny then return end
-- Number 100: Numeron Dragon (the destroy trigger): "any player(s) that has a Spell/Trap in their Graveyard Sets 1" is every living duelist (R1).
-- Each opposing duelist chooses in a SEAT window. The window index is kept per card: the Set of a card is done in the window of the seat
-- that chose it (the owner of a card is folded to 1 in FFA, so it cannot tell the seat), after the Necro Valley check.
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(nil,tp,LOCATION_MZONE,LOCATION_MZONE,nil)
	if Duel.Destroy(g,REASON_EFFECT)==0 then return end
	Duel.BreakEffect()
	local sets={}
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SET)
	local tc1=Duel.SelectMatchingCard(tp,s.setfilter,tp,LOCATION_GRAVE,0,1,1,nil,tp):GetFirst()
	if tc1 then table.insert(sets,{false,tc1}) end
	aux.MPEachOpponent(function(i)
		Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_SET)
		local tc=Duel.SelectMatchingCard(1-tp,s.setfilter,1-tp,LOCATION_GRAVE,0,1,1,nil,1-tp):GetFirst()
		if tc then table.insert(sets,{i,tc}) end
	end)()
	for _,v in ipairs(sets) do
		if v[2]:IsHasEffect(EFFECT_NECRO_VALLEY) then return end
	end
	for _,v in ipairs(sets) do
		if not v[1] then
			Duel.SSet(tp,v[2])
		elseif v[1]==0 then
			Duel.SSet(1-tp,v[2])
		else
			Duel.MPWindow(v[1])
			Duel.SSet(1-tp,v[2])
			Duel.MPWindowEnd()
		end
	end
end
-- "Your opponent attacks directly": the attack must be AT YOU. Duel.MPAttackedSeat (core) gives the real seat of the attacked duelist, so in FFA the
-- condition holds only for the owner of this card (a direct attack at another seat that also has no monster is not at you). Without that function
-- (an older core) the attack counts when you are the only seat it can go to: a direct attack goes to a seat with no monster, so every other seat
-- (not the attacker) controls a monster; if another seat has no monster too, the attack may be at that seat and it does not count.
-- Two seats and Tag: the stock condition.
local stock_spcon=s.spcon
function s.spcon(e,tp,eg,ep,ev,re,r,rp)
	if not stock_spcon(e,tp,eg,ep,ev,re,r,rp) then return false end
	if not (Duel.MPMode and Duel.MPMode()==1) then return true end
	if Duel.MPAttackedSeat and Duel.MPSeatOf then
		return Duel.MPAttackedSeat()==Duel.MPSeatOf(e:GetHandler())
	end
	local atk=Duel.GetAttacker()
	local other=false
	for i=1,Duel.MPOppCount() do
		Duel.MPWindow(i)
		if not Duel.GetFieldGroup(tp,0,LOCATION_ALL):IsContains(atk) and Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)==0 then other=true end
		Duel.MPWindowEnd()
	end
	return not other
end
