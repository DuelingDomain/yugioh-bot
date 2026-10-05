if not aux.MPChooseOpponent then return end
-- Fifty Fifty?: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	if not Duel.IsPlayerCanRemove(tp) then return end
	local g=Duel.GetMatchingGroup(aux.OR(Card.IsMonster,Card.IsTrap),tp,LOCATION_DECK,0,nil)
	if #g<3 then return end
	local sg=aux.SelectUnselectGroup(g,e,tp,3,3,s.rescon,1,tp,HINTMSG_CONFIRM)
	if #sg==0 then return end
	local opp=1-tp
	if not aux.MPChooseOpponent(tp) then return end
	Duel.ConfirmCards(opp,sg)
	local picked_card=sg:RandomSelect(opp,1):GetFirst()
	sg:RemoveCard(picked_card)
	Duel.ConfirmCards(tp,sg)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_REMOVE)
	local banished_card=sg:FilterSelect(tp,aux.AND(Card.IsTrap,Card.IsAbleToRemove),1,1,nil)
	if #banished_card==0 or Duel.Remove(banished_card,POS_FACEUP,REASON_EFFECT)==0 then return end
	sg:RemoveCard(banished_card)
	local op=Duel.SelectEffect(opp,
		{true,aux.Stringid(id,1)},
		{true,aux.Stringid(id,2)})
	Duel.BreakEffect()
	if op==1 then
		--● Show the picked card, and if it is a monster, either add it to your hand or Special Summon it. Otherwise, banish it. Shuffle the remaining card into the Deck
		Duel.ConfirmCards(opp,picked_card)
		if picked_card:IsMonster() then
			aux.ToHandOrElse(picked_card,tp,
				function()
					return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and picked_card:IsCanBeSpecialSummoned(e,0,tp,false,false)
				end,
				function()
					Duel.SpecialSummon(picked_card,0,tp,tp,false,false,POS_FACEUP)
				end,
				aux.Stringid(id,3)
			)
		else
			Duel.Remove(picked_card,POS_FACEUP,REASON_EFFECT)
		end
	elseif op==2 then
		--● Show the card that was not picked nor banished, and if it is a monster, add it to your hand. Otherwise, banish it. Shuffle the remaining card into the Deck
		local other_card=sg:GetFirst()
		Duel.ConfirmCards(opp,other_card)
		if other_card:IsMonster() then
			Duel.SendtoHand(other_card,nil,REASON_EFFECT)
		else
			Duel.Remove(other_card,POS_FACEUP,REASON_EFFECT)
		end
	end
	Duel.ShuffleDeck(tp)
end
