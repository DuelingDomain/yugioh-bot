if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	local cl=Duel.MPChainCount()
	if chk==0 then return Duel.GetFieldGroupCount(tp,LOCATION_DECK,0)>=cl
		and (cl<3 or Duel.IsPlayerCanDiscardDeck(tp,1))
		and (cl<4 or Duel.IsPlayerCanDraw(tp,1))
	end
	if cl>=3 then Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_DECK) end
	if cl>=4 then Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1) end
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local break_chk=false
	local cl=Duel.MPChainCount()
	if cl>=2 then
		break_chk=true
		Duel.ConfirmDecktop(tp,cl)
		Duel.SortDecktop(tp,tp,cl)
	end
	if cl>=3 and Duel.IsPlayerCanDiscardDeck(tp,1) then
		if break_chk then Duel.BreakEffect() end
		break_chk=true
		Duel.DiscardDeck(tp,1,REASON_EFFECT)
	end
	if cl>=4 then
		if break_chk then Duel.BreakEffect() end
		Duel.Draw(tp,1,REASON_EFFECT)
	end
end
