if not aux.MPAny then return end
-- Number 100: Numeron Dragon (the destroy trigger): "any player(s) that has a Spell/Trap in their Graveyard Sets 1" is every living duelist (R1).
-- Each opposing duelist chooses in a SEAT window; the Set is done by the owner of the card after the Necro Valley check.
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(nil,tp,LOCATION_MZONE,LOCATION_MZONE,nil)
	if Duel.Destroy(g,REASON_EFFECT)==0 then return end
	Duel.BreakEffect()
	local sets={}
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SET)
	local tc1=Duel.SelectMatchingCard(tp,s.setfilter,tp,LOCATION_GRAVE,0,1,1,nil,tp):GetFirst()
	if tc1 then table.insert(sets,{tp,tc1}) end
	aux.MPEachOpponent(function()
		Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_SET)
		local tc=Duel.SelectMatchingCard(1-tp,s.setfilter,1-tp,LOCATION_GRAVE,0,1,1,nil,1-tp):GetFirst()
		if tc then table.insert(sets,{false,tc}) end
	end)()
	for _,v in ipairs(sets) do
		if v[2]:IsHasEffect(EFFECT_NECRO_VALLEY) then return end
	end
	for _,v in ipairs(sets) do
		Duel.SSet(v[1] or v[2]:GetOwner(),v[2])
	end
end
