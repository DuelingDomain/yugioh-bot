if not aux.MPForEachDuelist then return end
-- Two-for-One Team: EVERY living duelist shows a card of its hand, and the effect depends on the types of all the shown cards (R1, Q3, Q10).
-- Each duelist sees the cards of the others. All Monsters: each duelist may Special Summon its own. All Spells: each draws 2. All Traps: each sends 2 from its Deck.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		return aux.MPAllDuelists(function(tp_i) return Duel.GetMatchingGroupCount(s.filter,tp_i,LOCATION_HAND,0,nil)>0 end)
	end
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local ready=aux.MPAllDuelists(function(tp_i) return Duel.GetMatchingGroupCount(s.filter,tp_i,LOCATION_HAND,0,nil)>0 end)
	if not ready then return end
	local shown={}
	local all=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i,seat_i)
		Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_CONFIRM)
		local tc=Duel.GetMatchingGroup(s.filter,tp_i,LOCATION_HAND,0,nil):Select(tp_i,1,1,nil):GetFirst()
		shown[seat_i]=tc
		all:AddCard(tc)
	end)
	aux.MPForEachDuelist(function(tp_i,seat_i)
		Duel.ConfirmCards(tp_i,all-shown[seat_i])
	end)
	local mon,spell,trap=true,true,true
	for _,tc in pairs(shown) do
		if not tc:IsMonster() then mon=false end
		if not tc:IsSpell() then spell=false end
		if not tc:IsTrap() then trap=false end
	end
	if mon then
		local ask={}
		aux.MPForEachDuelist(function(tp_i,seat_i) ask[seat_i]=Duel.SelectYesNo(tp_i,aux.Stringid(id,1)) end)
		aux.MPForEachDuelist(function(tp_i,seat_i)
			local tc=shown[seat_i]
			if Duel.GetLocationCount(tp_i,LOCATION_MZONE)>0 and tc:IsCanBeSpecialSummoned(e,0,tp_i,false,false) and ask[seat_i] then
				Duel.SpecialSummonStep(tc,0,tp_i,tp_i,false,false,POS_FACEUP)
			end
		end)
		Duel.SpecialSummonComplete()
	elseif spell then
		if aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDraw(tp_i,2) end) then
			aux.MPForEachDuelist(function(tp_i) Duel.Draw(tp_i,2,REASON_EFFECT) end)
		end
	elseif trap then
		if aux.MPAllDuelists(function(tp_i) return Duel.IsExistingMatchingCard(Card.IsAbleToGrave,tp_i,LOCATION_DECK,0,2,nil) end) then
			aux.MPForEachDuelist(function(tp_i)
				Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_TOGRAVE)
				local g=Duel.SelectMatchingCard(tp_i,Card.IsAbleToGrave,tp_i,LOCATION_DECK,0,2,2,nil)
				Duel.SendtoGrave(g,REASON_EFFECT)
			end)
		end
	end
end
