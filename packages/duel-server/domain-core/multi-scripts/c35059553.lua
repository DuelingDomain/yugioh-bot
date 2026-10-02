if not aux.MPAny then return end
-- Kaiser Colosseum (script fix, review A item 3): the Tribute Summon limit compares the monsters of the SUMMONING duelist with yours.
-- The stock value reads "your opponent" as one side (y = Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)). At 3 or 4 seats (FFA) that is the
-- SUM of every opponent, so one duelist was limited by the monsters of the others. y is the monster count of the controller of c only.
-- Tag keeps the joined opposing side (owner decision, question 2). The other function of the card (EFFECT_MAX_MZONE) is a per-duelist value and stays.
function s.sumlimit(e,c)
	local tp=e:GetHandlerPlayer()
	if c:IsControler(1-tp) then
		local mint,maxt=c:GetTributeRequirement()
		local x=Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)
		local y=Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)
		if Duel.MPMode()==1 then
			-- c:GetControler() and c:IsControler(1-tp) are folded (1 for every opponent), so the seat of c is found as the window
			-- (seat i of the opponents) whose cards hold c.
			for i=1,Duel.MPOppCount() do
				Duel.MPWindow(i)
				if Duel.GetFieldGroup(tp,0,LOCATION_ALL):IsContains(c) then y=Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end
				Duel.MPWindowEnd()
			end
		end
		local ex=Duel.GetMatchingGroupCount(Card.IsHasEffect,tp,LOCATION_MZONE,0,nil,EFFECT_EXTRA_RELEASE)
		local exs=Duel.GetMatchingGroupCount(Card.IsHasEffect,tp,LOCATION_MZONE,0,nil,EFFECT_EXTRA_RELEASE_SUM)
		if ex==0 and exs>0 then ex=1 end
		return y-maxt+ex+1 > x-ex
	else
		return false
	end
end
