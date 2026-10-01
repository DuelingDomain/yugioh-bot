if not aux.MPForEachDuelist then return end
-- Add 1 monster that lists the Shining Sarcophagus; in the Battle Phase, with the right cards, every duelist draws until it has 6
-- cards in hand (R1, Q3, Tag partner included). The activation needs every duelist to be able to draw. `draw` only reads the activator.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	local draw=Duel.IsBattlePhase() and e:IsHasType(EFFECT_TYPE_ACTIVATE)
		and Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,CARD_SHINING_SARCOPHAGUS),tp,LOCATION_ONFIELD,0,1,nil)
		and Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.ListsCode,CARD_SHINING_SARCOPHAGUS),tp,LOCATION_MZONE,0,1,nil)
	if chk==0 then return Duel.IsExistingMatchingCard(s.thfilter,tp,LOCATION_DECK,0,1,nil)
		and (not draw or aux.MPAllDuelists(function(tp_i)
			local ct=6-Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0)
			return ct>0 and Duel.IsPlayerCanDraw(tp_i,ct)
		end)) end
	Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)
	if draw then
		e:SetLabel(1)
		Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,1)
	else
		e:SetLabel(0)
	end
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
	local g=Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)
	if #g==0 or Duel.SendtoHand(g,nil,REASON_EFFECT)==0 then return end
	Duel.ConfirmCards(1-tp,g)
	if e:GetLabel()==0 then return end
	Duel.ShuffleHand(tp)
	Duel.ShuffleDeck(tp)
	local broke=false
	aux.MPForEachDuelist(function(tp_i)
		local ct=6-Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0)
		if ct>0 then
			if not broke then Duel.BreakEffect() broke=true end
			Duel.Draw(tp_i,ct,REASON_EFFECT)
		end
	end)
end
