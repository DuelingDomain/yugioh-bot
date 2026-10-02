if not aux.MPForEachDuelist then return end
-- Number 100: Numeron Dragon (the destroy trigger): "any player(s) that has a Spell/Trap in their Graveyard Sets 1" is every living duelist (R1,
-- Q3: in Tag the partners are players too). Each duelist chooses from its OWN Graveyard in its own seat scope (aux.MPForEachDuelist), then, after
-- the Necro Valley check on every chosen card, each duelist Sets its card in a second pass over the same scopes.
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(nil,tp,LOCATION_MZONE,LOCATION_MZONE,nil)
	if Duel.Destroy(g,REASON_EFFECT)==0 then return end
	Duel.BreakEffect()
	local sets={}
	local chosen=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i,seat_i)
		Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_SET)
		-- In Tag the Graveyard of a scope is the one of the team: the partner must not choose the card that its partner chose (it is still in the GY).
		local tc=Duel.SelectMatchingCard(tp_i,s.setfilter,tp_i,LOCATION_GRAVE,0,1,1,chosen,tp_i):GetFirst()
		if tc then
			sets[seat_i]=tc
			chosen:AddCard(tc)
		end
	end)
	for _,tc in pairs(sets) do
		if tc:IsHasEffect(EFFECT_NECRO_VALLEY) then return end
	end
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local tc=sets[seat_i]
		if tc then Duel.SSet(tp_i,tc) end
	end)
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
