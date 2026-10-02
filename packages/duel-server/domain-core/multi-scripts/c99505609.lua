if not aux.MPForEachDuelist then return end
-- After the column is destroyed every duelist draws 1 card (R1, Q3, Tag partner included). The target needs every duelist to be able
-- to draw. The choice 1/2 effect (own or the opponent's zone) stays stock.
function s.destg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(s.columnfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)
		and aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDraw(tp_i,1) end) end
	local g=Duel.GetFieldGroup(tp,LOCATION_ONFIELD,LOCATION_ONFIELD)
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,4,tp,0)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,1)
end
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
	local sc=Duel.SelectMatchingCard(tp,s.columnfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil):GetFirst()
	if not sc then return end
	Duel.HintSelection(sc)
	local c=e:GetHandler()
	local g=sc:GetColumnGroup():AddCard(sc)
	if c:IsRelateToEffect(e) then g:RemoveCard(c) end
	if Duel.Destroy(g,REASON_EFFECT)>0 then
		Duel.BreakEffect()
		aux.MPForEachDuelist(function(tp_i) Duel.Draw(tp_i,1,REASON_EFFECT) end)
	end
end
