if not aux.MPAny then return end
local function anyopp(fn)
	if Duel.MPMode()==0 then return fn() end
	for i=1,Duel.MPOppCount() do
		Duel.MPWindow(i)
		local r=fn()
		Duel.MPWindowEnd()
		if r then return true end
	end
	return false
end
-- Compulsory Escape Device: "each player" is every living duelist (R1). It needs a monster of yours and a monster of at least one opponent;
-- every opposing duelist who controls a monster chooses 1 of their own, one after the other.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(Card.IsAbleToDeck,tp,LOCATION_MZONE,0,1,nil)
		and anyopp(function() return Duel.IsExistingMatchingCard(Card.IsAbleToDeck,tp,0,LOCATION_MZONE,1,nil) end) end
	Duel.SetOperationInfo(0,CATEGORY_TODECK,nil,2,PLAYER_ALL,LOCATION_MZONE)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TODECK)
	local dg=Duel.SelectMatchingCard(tp,Card.IsAbleToDeck,tp,LOCATION_MZONE,0,1,1,nil)
	aux.MPEachOpponent(function()
		Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_TODECK)
		dg:Merge(Duel.SelectMatchingCard(1-tp,Card.IsAbleToDeck,1-tp,LOCATION_MZONE,0,1,1,nil))
	end)()
	Duel.HintSelection(dg)
	Duel.SendtoDeck(dg,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)
end
