if not aux.MPForEachDuelist then return end
-- Every duelist draws until it has 6 cards in hand (R1, Q3, Tag partner included). The condition asks if ANY one opponent has fewer cards
-- in hand than you (aux.MPAnyOpponent, it asks for no pick). The target needs every duelist to be able to draw. A duelist draws in turn
-- order from the duelist that runs the effect.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	if not (Duel.IsBattlePhase() and Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_SILENT_MAGICIAN),tp,LOCATION_MZONE,0,1,nil)) then return false end
	local own=Duel.GetFieldGroupCount(tp,LOCATION_HAND,0)
	return aux.MPAnyOpponent(tp,function(tp_i) return own>Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0) end)
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		return aux.MPAllDuelists(function(tp_i)
			local ct=6-Duel.GetMatchingGroupCount(nil,tp_i,LOCATION_HAND,0,e:GetHandler())
			return ct>0 and Duel.IsPlayerCanDraw(tp_i,ct)
		end)
	end
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,1)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local broke=false
	aux.MPForEachDuelist(function(tp_i)
		local ct=6-Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0)
		if ct>0 then
			if not broke then Duel.BreakEffect() broke=true end
			Duel.Draw(tp_i,ct,REASON_EFFECT)
		end
	end)
end
