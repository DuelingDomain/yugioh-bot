if not aux.MPForEachDuelist then return end
if not aux.MPAllDuelists or not Duel.MPOwnerSeat then return end
-- Owner 2026-10-18: every living duelist returns its hand and draws; only the activator pays LP.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAllDuelists(function(p)
		return Duel.GetFieldGroupCount(p,LOCATION_HAND,0)>=3
	end)
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(p) return Duel.IsPlayerCanDraw(p,5) end) end
	Duel.SetOperationInfo(0,CATEGORY_TODECK,nil,0,0,0)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,5)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local hands=Group.CreateGroup()
	aux.MPForEachDuelist(function(p) hands:Merge(Duel.GetFieldGroup(p,LOCATION_HAND,0)) end)
	if #hands==0 then return end
	Duel.SendtoDeck(hands,nil,SEQ_DECKBOTTOM,REASON_EFFECT)
	local returned=Duel.GetOperatedGroup():Filter(Card.IsLocation,nil,LOCATION_DECK)
	local total=#returned
	-- A foreign-owned hand card returns to its real owner's Deck. That owner sorts it.
	aux.MPForEachDuelistFromTurn(function(p,seat)
		local count=returned:FilterCount(function(c) return Duel.MPOwnerSeat(c)==seat end,nil)
		if count>0 then Duel.SortDeckbottom(p,p,count) end
	end)
	Duel.SetLP(tp,Duel.GetLP(tp)-total*300)
	if Duel.GetLP(tp)>0 then
		Duel.BreakEffect()
		aux.MPForEachDuelistFromTurn(function(p) Duel.Draw(p,5,REASON_EFFECT) end)
	end
end
