if not aux.MPAny then return end
-- Emperor Sem: "each player" is every living duelist (R1). Each opponent may also select 1 card from their own Graveyard (yes/no, then the target), one after the other.
function s.tdtg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return false end
	if chk==0 then return Duel.IsExistingTarget(Card.IsAbleToDeck,tp,LOCATION_GRAVE,0,1,nil) end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TODECK)
	local g1=Duel.SelectTarget(tp,Card.IsAbleToDeck,tp,LOCATION_GRAVE,0,1,1,nil)
	aux.MPEachOpponent(function()
		if Duel.IsExistingTarget(Card.IsAbleToDeck,tp,0,LOCATION_GRAVE,1,nil)
			and Duel.SelectYesNo(1-tp,aux.Stringid(id,1)) then
			Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_TODECK)
			g1:Merge(Duel.SelectTarget(1-tp,Card.IsAbleToDeck,1-tp,LOCATION_GRAVE,0,1,1,nil))
		end
	end)()
	Duel.SetOperationInfo(0,CATEGORY_TODECK,g1,#g1,0,0)
end
