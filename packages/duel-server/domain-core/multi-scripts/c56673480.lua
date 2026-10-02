if not aux.MPForEachDuelist then return end
-- Contract with Don Thousand: "both players" is every living duelist (R1, Q3, Tag partner included). The stock lines name tp and 1-tp, which
-- reach the own side and ONE opponent. The activation needs every duelist to be able to draw; each one loses 1000 LP, then each one draws 1 card.
-- A defeated duelist is not listed by MPForEachDuelist (Q9). In Tag the LP is the team LP, so a team with two duelists pays 2000.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		local ok=true
		aux.MPForEachDuelist(function(tp_i)
			if not Duel.IsPlayerCanDraw(tp_i,1) then ok=false return true end
		end)
		return ok
	end
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,1)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i) Duel.SetLP(tp_i,Duel.GetLP(tp_i)-1000) end)
	aux.MPForEachDuelist(function(tp_i) Duel.Draw(tp_i,1,REASON_EFFECT) end)
end
