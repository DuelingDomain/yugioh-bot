if not aux.MPForEachDuelist then return end
-- Every duelist draws 1 card (R1, Q3, Tag partner included). The target needs every duelist to be able to draw.
function s.drtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDraw(tp_i,1) end) end
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,1)
end
function s.drop(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i) Duel.Draw(tp_i,1,REASON_EFFECT) end)
end
