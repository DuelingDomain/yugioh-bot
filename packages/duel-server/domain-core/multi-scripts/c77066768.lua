if not aux.MPForEachDuelist then return end
-- Declare a type; every duelist reveals the bottom card of its Deck (R1, Q3, Tag partner included). A card of the type goes to the hand,
-- another card goes to the top of the Deck. Every duelist needs a Deck. The bottom cards are read per real seat before any card moves.
function s.decltg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.GetFieldGroupCount(tp_i,LOCATION_DECK,0)>0 end) end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_OPTION)
	local op=Duel.SelectOption(tp,DECLTYPE_MONSTER,DECLTYPE_SPELL,DECLTYPE_TRAP)
	e:SetLabel(op)
	Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,PLAYER_ALL,LOCATION_DECK)
end
function s.declop(e,tp,eg,ep,ev,re,r,rp)
	if not aux.MPAllDuelists(function(tp_i) return Duel.GetFieldGroupCount(tp_i,LOCATION_DECK,0)>0 end) then return end
	local label=e:GetLabel()
	local decl_type=(label==0 and TYPE_MONSTER)
		or (label==1 and TYPE_SPELL)
		or (label==2 and TYPE_TRAP)
	local bottom={}
	local all=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local c=Duel.GetDeckbottomGroup(tp_i,1):GetFirst()
		if c then
			bottom[seat_i]=c
			all:AddCard(c)
		end
	end)
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local others=all:Clone()
		if bottom[seat_i] then others:RemoveCard(bottom[seat_i]) end
		if #others>0 then Duel.ConfirmCards(tp_i,others) end
	end)
	Duel.DisableShuffleCheck()
	local handed=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local c=bottom[seat_i]
		if not c then return end
		if c:IsType(decl_type) and c:IsAbleToHand() then
			Duel.SendtoHand(c,nil,REASON_EFFECT)
			handed:AddCard(c)
			Duel.ShuffleHand(tp_i)
		else
			Duel.MoveSequence(c,SEQ_DECKTOP)
			Duel.ConfirmDecktop(tp_i,1)
		end
	end)
	if #handed>0 then
		aux.MPForEachDuelist(function(tp_i,seat_i)
			local others=handed:Clone()
			if bottom[seat_i] then others:RemoveCard(bottom[seat_i]) end
			if #others>0 then Duel.ConfirmCards(tp_i,others) end
		end)
	end
end
