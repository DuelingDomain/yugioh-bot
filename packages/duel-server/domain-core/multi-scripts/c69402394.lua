if not aux.MPForEachDuelist then return end
-- Every duelist discards 2 cards and draws 2 cards (R1, Q3, Tag partner included). The target and the effect need 2 cards in the hand of
-- every duelist (the handler is not counted). "Your opponent can discard 1 card to negate" is ONE opponent (Q5, R-COMMON-OPP-PICK): the owner
-- picks it when the effect is put on the chain (the target step asks for the pick, aux.MPPick), and only that duelist is asked in the operation.
-- The negate prompt and the discard read 1-tp BEFORE the loops, because inside a loop the scope is the duelist of the loop, not the bound opponent.
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
	if Duel.SelectYesNo(1-tp,aux.Stringid(id,0)) then
		Duel.DiscardHand(1-tp,aux.TRUE,1,1,REASON_EFFECT|REASON_DISCARD,nil)
		if Duel.IsChainDisablable(0) then
			Duel.NegateEffect(0)
			return
		end
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
local stock_target=s.target
s.target=aux.MPPick(stock_target)
