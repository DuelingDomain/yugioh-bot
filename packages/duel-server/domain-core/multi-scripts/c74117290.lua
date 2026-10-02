if not aux.MPForEachDuelist then return end
-- Every duelist draws 1 card and discards 1 card (R1, Q3, Tag partner included). `drew` is kept per real seat.
-- The target needs every duelist to be able to draw.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDraw(tp_i,1) end) end
	Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,PLAYER_ALL,1)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,1)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local drew={}
	local any=false
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if Duel.Draw(tp_i,1,REASON_EFFECT)>0 then
			drew[seat_i]=true
			any=true
		end
	end)
	if any then Duel.BreakEffect() end
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if drew[seat_i] then
			Duel.ShuffleHand(tp_i)
			Duel.DiscardHand(tp_i,aux.TRUE,1,1,REASON_EFFECT|REASON_DISCARD)
		end
	end)
end
