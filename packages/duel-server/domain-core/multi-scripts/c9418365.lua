if not aux.MPForEachDuelist then return end
-- Every duelist discards 1 card (R1, Q3, Tag partner included): the duelist that runs the effect first, then the others in turn order.
-- The target needs a card in the hand of every duelist.
function s.hdtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0)>0 end) end
	Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,PLAYER_ALL,1)
end
function s.hdop(e,tp,eg,ep,ev,re,r,rp)
	local first=true
	aux.MPForEachDuelist(function(tp_i)
		if first then
			first=false
			if Duel.DiscardHand(tp_i,nil,1,1,REASON_EFFECT|REASON_DISCARD)==0 then return true end
			Duel.BreakEffect()
		else
			Duel.DiscardHand(tp_i,nil,1,1,REASON_EFFECT|REASON_DISCARD)
		end
	end)
end
