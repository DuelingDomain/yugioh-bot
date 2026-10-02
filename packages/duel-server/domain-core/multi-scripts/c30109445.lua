if not aux.MPForEachDuelist then return end
-- Choice 2: every duelist shuffles its hand into the Deck and draws that many cards (R1, Q3, Tag partner included), the duelist that runs
-- the effect first. The choice is open when ANY duelist can draw and has a card in hand. The Deck of the duelist is read in its own window.
function s.efftg(e,tp,eg,ep,ev,re,r,rp,chk)
	local b1=not Duel.HasFlagEffect(tp,id)
		and Duel.IsExistingMatchingCard(aux.AND(Card.IsLinkMonster,Card.IsFaceup,Card.IsAbleToExtra),tp,LOCATION_MZONE|LOCATION_GRAVE,LOCATION_MZONE|LOCATION_GRAVE,1,nil)
	local b2=not Duel.HasFlagEffect(tp,id+1) and aux.MPAnyDuelist(function(tp_i)
		return Duel.IsPlayerCanDraw(tp_i) and Duel.IsExistingMatchingCard(Card.IsAbleToDeck,tp_i,LOCATION_HAND,0,1,nil)
	end)
	if chk==0 then return b1 or b2 end
	local op=Duel.SelectEffect(tp,
		{b1,aux.Stringid(id,1)},
		{b2,aux.Stringid(id,2)})
	e:SetLabel(op)
	if op==1 then
		Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)
		e:SetCategory(CATEGORY_TOEXTRA)
		Duel.SetOperationInfo(0,CATEGORY_TOEXTRA,nil,1,PLAYER_ALL,LOCATION_MZONE|LOCATION_GRAVE)
	elseif op==2 then
		Duel.RegisterFlagEffect(tp,id+1,RESET_PHASE|PHASE_END,0,1)
		e:SetCategory(CATEGORY_TODECK|CATEGORY_DRAW)
		Duel.SetOperationInfo(0,CATEGORY_TODECK,nil,1,PLAYER_ALL,LOCATION_HAND)
		Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,1)
	end
end
function s.effop(e,tp,eg,ep,ev,re,r,rp)
	local op=e:GetLabel()
	if op==1 then
		local g=Duel.GetMatchingGroup(aux.AND(Card.IsLinkMonster,Card.IsFaceup,Card.IsAbleToExtra),tp,LOCATION_MZONE|LOCATION_GRAVE,LOCATION_MZONE|LOCATION_GRAVE,nil)
		if #g>0 then
			Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)
		end
	elseif op==2 then
		aux.MPForEachDuelist(function(tp_i)
			local g=Duel.GetFieldGroup(tp_i,LOCATION_HAND,0)
			if #g>0 and Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)>0 and Duel.IsPlayerCanDraw(tp_i) then
				local draw_count=#Duel.GetOperatedGroup()
				if draw_count>0 then
					Duel.ShuffleDeck(tp_i)
					Duel.BreakEffect()
					Duel.Draw(tp_i,draw_count,REASON_EFFECT)
				end
			end
		end)
	end
end
