if not aux.MPForEachDuelist then return end
-- Choice 2: every duelist shuffles its hand into the Deck and draws that many cards (R1, Q3, Tag partner included). The group of all hands
-- is built per duelist; the Deck of every controller that got a card is shuffled (aux.MPForEachController); the cards to draw are kept per
-- real seat. The duelist that runs the effect is first.
function s.efftg(e,tp,eg,ep,ev,re,r,rp,chk)
	local event_chaining,_,_,event_value,reason_effect,_,reason_player=Duel.CheckEvent(EVENT_CHAINING,true)
	local b1=event_chaining and Duel.IsExistingMatchingCard(Card.IsSpellTrap,reason_player,0,LOCATION_ONFIELD,1,nil)
		and ((reason_effect:IsMonsterEffect() and Duel.GetChainInfo(event_value,CHAININFO_TRIGGERING_LOCATION)==LOCATION_MZONE)
		or (reason_effect:GetHandler():IsNormalSpellTrap() and reason_effect:IsHasType(EFFECT_TYPE_ACTIVATE)))
	local b2=aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDraw(tp_i) or Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0)==0 end)
		and aux.MPAnyDuelist(function(tp_i) return Duel.IsExistingMatchingCard(Card.IsAbleToDeck,tp_i,LOCATION_HAND,0,1,nil) end)
	if chk==0 then return b1 or b2 end
	local op=not b1 and 2
		or Duel.SelectEffect(tp,
			{b1,aux.Stringid(id,1)},
			{b2,aux.Stringid(id,2)})
	e:SetLabel(op)
	if op==1 then
		e:SetCategory(0)
		Duel.SetTargetParam(event_value)
	elseif op==2 then
		e:SetCategory(CATEGORY_TODECK+CATEGORY_DRAW)
		if not b1 then Duel.Hint(HINT_OPSELECTED,1-tp,aux.Stringid(id,2)) end
		Duel.SetOperationInfo(0,CATEGORY_TODECK,nil,1,PLAYER_ALL,LOCATION_HAND)
		Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,1)
	end
end
function s.effop(e,tp,eg,ep,ev,re,r,rp)
	local op=e:GetLabel()
	if op==1 then
		local g=Group.CreateGroup()
		local event_value=Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM)
		Duel.ChangeTargetCard(event_value,g)
		Duel.ChangeChainOperation(event_value,s.repop)
	elseif op==2 then
		local g=Group.CreateGroup()
		aux.MPForEachDuelist(function(tp_i) g:Merge(Duel.GetFieldGroup(tp_i,LOCATION_HAND,0)) end)
		if Duel.SendtoDeck(g,nil,SEQ_DECKTOP,REASON_EFFECT)>0 then
			local og=Duel.GetOperatedGroup():Match(Card.IsLocation,nil,LOCATION_DECK)
			local ct={}
			aux.MPForEachController(og,function(sg,seat,p)
				ct[seat]=#sg
				Duel.ShuffleDeck(p)
			end)
			Duel.BreakEffect()
			aux.MPForEachDuelist(function(tp_i,seat_i)
				if (ct[seat_i] or 0)>0 then
					Duel.Draw(tp_i,ct[seat_i],REASON_EFFECT)
				end
			end)
		end
	end
end
