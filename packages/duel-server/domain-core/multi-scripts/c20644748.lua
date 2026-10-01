if not aux.MPAny then return end
-- Spatial Collapse: "each player" is every living duelist (R1). The condition needs every opposing duelist at 5 cards or fewer.
-- The adjust effect cannot ask, so each opposing duelist is handled in a SEAT window (MPEachOpponent) and picks their own cards.
local function opponents_ok(tp)
	if Duel.MPMode()==0 then return Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD)<=5 end
	for i=1,Duel.MPOppCount() do
		Duel.MPWindow(i)
		local ct=Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD)
		Duel.MPWindowEnd()
		if ct>5 then return false end
	end
	return true
end
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return Duel.GetFieldGroupCount(tp,LOCATION_ONFIELD,0)<=5 and opponents_ok(tp)
end
function s.adjustop(e,tp,eg,ep,ev,re,r,rp)
	local phase=Duel.GetCurrentPhase()
	if (phase==PHASE_DAMAGE and not Duel.IsDamageCalculated()) or phase==PHASE_DAMAGE_CAL then return end
	local c1=Duel.GetFieldGroupCount(tp,LOCATION_ONFIELD,0)
	local over=c1>5
	local g=Group.CreateGroup()
	if over then
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)
		g:Merge(Duel.SelectMatchingCard(tp,nil,tp,LOCATION_ONFIELD,0,c1-5,c1-5,nil))
	end
	aux.MPEachOpponent(function()
		local c2=Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD)
		if c2>5 then
			over=true
			Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_TOGRAVE)
			g:Merge(Duel.SelectMatchingCard(1-tp,nil,1-tp,LOCATION_ONFIELD,0,c2-5,c2-5,nil))
		end
	end)()
	if over then
		Duel.SendtoGrave(g,REASON_EFFECT)
		Duel.Readjust()
	end
end
