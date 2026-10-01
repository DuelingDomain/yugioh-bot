if not aux.MPForEachDuelist then return end
-- After the random discard of the opponent every duelist draws 1 card (R1, Q3, Tag partner included). The target needs every duelist to
-- be able to draw. The random discard of "your opponent" stays stock.
function s.tgtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.GetFieldGroupCount(1-tp,LOCATION_HAND,0)>0
		and aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDraw(tp_i,1) end) end
	Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,1-tp,LOCATION_HAND)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,1)
end
function s.tgop(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetFieldGroup(1-tp,LOCATION_HAND,0)
	if #g==0 then return end
	local sg=g:RandomSelect(1-tp,1)
	if Duel.SendtoGrave(sg,REASON_EFFECT)>0 then
		local og=Duel.GetOperatedGroup()
		if og:GetFirst():IsLocation(LOCATION_GRAVE) then
			Duel.BreakEffect()
			aux.MPForEachDuelist(function(tp_i) Duel.Draw(tp_i,1,REASON_EFFECT) end)
		end
	end
end
