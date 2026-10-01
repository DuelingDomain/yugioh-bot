if not aux.MPForEachDuelist then return end
-- Every duelist discards 2 cards and draws 2 cards (R1, Q3, Tag partner included). The target and the effect need 2 cards in the hand of
-- every duelist (the handler is not counted). Every opponent in turn order may discard 1 card to negate; the first that accepts ends the asking.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		return aux.MPAllDuelists(function(tp_i)
			return Duel.GetMatchingGroupCount(nil,tp_i,LOCATION_HAND,0,e:GetHandler())>1
				and Duel.GetFieldGroupCount(tp_i,LOCATION_DECK,0)>1
		end)
	end
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,2)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	if not aux.MPAllDuelists(function(tp_i) return Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0)>=2 end) then return end
	local me=aux.MPKey(tp)
	local accepted=false
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if aux.MPKeyOfSeat(seat_i)~=me and Duel.SelectYesNo(tp_i,aux.Stringid(id,0)) then
			Duel.DiscardHand(tp_i,aux.TRUE,1,1,REASON_EFFECT|REASON_DISCARD,nil)
			accepted=true
			return true
		end
	end)
	if accepted and Duel.IsChainDisablable(0) then
		Duel.NegateEffect(0)
		return
	end
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i)
		Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_DISCARD)
		g:Merge(Duel.SelectMatchingCard(tp_i,aux.TRUE,tp_i,LOCATION_HAND,0,2,2,nil))
	end)
	Duel.SendtoGrave(g,REASON_EFFECT|REASON_DISCARD)
	Duel.BreakEffect()
	aux.MPForEachDuelist(function(tp_i) Duel.Draw(tp_i,2,REASON_EFFECT) end)
end
