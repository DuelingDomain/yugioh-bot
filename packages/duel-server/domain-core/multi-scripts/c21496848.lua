if not aux.MPForEachDuelist then return end
-- Choose a type; every duelist sends 1 card of that type from its Deck to the GY (R1, Q3, Tag partner included). Every duelist needs a Deck.
-- "Your opponent may discard 1 card to negate": every opponent in turn order is asked, the first that accepts discards and ends the effect.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.GetFieldGroupCount(tp_i,LOCATION_DECK,0)>0 end) end
	Duel.Hint(HINT_SELECTMSG,tp,aux.Stringid(id,5))
	local ac=Duel.SelectOption(tp,aux.Stringid(id,1),aux.Stringid(id,2),aux.Stringid(id,3))
	e:SetLabel(ac)
	Duel.SetPossibleOperationInfo(0,CATEGORY_HANDES,nil,0,PLAYER_ALL,1)
	Duel.SetPossibleOperationInfo(0,CATEGORY_TOGRAVE,nil,1,PLAYER_ALL,LOCATION_DECK)
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local me=aux.MPKey(tp)
	local negated=false
	if Duel.IsChainDisablable(0) then
		aux.MPForEachDuelist(function(tp_i,seat_i)
			if aux.MPKeyOfSeat(seat_i)~=me and Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0)>0
				and Duel.SelectYesNo(tp_i,aux.Stringid(id,4)) then
				Duel.DiscardHand(tp_i,aux.TRUE,1,1,REASON_EFFECT|REASON_DISCARD)
				negated=true
				return true
			end
		end)
	end
	if negated then return end
	local ty=TYPE_MONSTER
	if e:GetLabel()==1 then ty=TYPE_SPELL
	elseif e:GetLabel()==2 then ty=TYPE_TRAP end
	local sg=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i)
		Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_TOGRAVE)
		sg:Merge(Duel.SelectMatchingCard(tp_i,Card.IsType,tp_i,LOCATION_DECK,0,1,1,nil,ty))
	end)
	Duel.SendtoGrave(sg,REASON_EFFECT)
end
