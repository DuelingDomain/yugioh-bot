if not aux.MPAny then return end
-- Backup Team: the draw count is read on the bound opponent. The Set effect asks if any one opponent controls more cards.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	local ct=aux.MPValue(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD) end)()
	if chk==0 then return Duel.IsPlayerCanDraw(tp,ct) end
	Duel.SetTargetPlayer(tp)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,ct)
	Duel.SetOperationInfo(0,CATEGORY_TODECK,nil,ct,tp,LOCATION_HAND)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local p=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)
	local ct=aux.MPValue(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD) end)()
	if Duel.Draw(p,ct,REASON_EFFECT)==ct then
		local g=Duel.GetMatchingGroup(Card.IsAbleToDeck,p,LOCATION_HAND,0,nil)
		if #g==0 then return end
		Duel.Hint(HINT_SELECTMSG,p,HINTMSG_TODECK)
		local sg=g:Select(p,ct,ct,nil)
		Duel.BreakEffect()
		if Duel.SendtoDeck(sg,nil,SEQ_DECKBOTTOM,REASON_EFFECT)==0 then return end
		local rt=Duel.GetOperatedGroup():FilterCount(Card.IsLocation,nil,LOCATION_DECK)
		if rt>0 then
			Duel.SortDeckbottom(p,p,rt)
		end
	end
end
function s.setcon(e,tp,eg,ep,ev,re,r,rp)
	return Duel.IsPhase(PHASE_END) and aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD)>Duel.GetFieldGroupCount(tp,LOCATION_ONFIELD,0) end)()
end
