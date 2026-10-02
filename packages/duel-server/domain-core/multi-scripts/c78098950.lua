if not aux.MPForEachDuelist then return end
-- Tsumuha-Kutsunagi the Lord of Swords: "your opponent" is every living opponent of the controller (R1, Q3, Q10): each one decides and sends
-- cards from its own field, then EVERY living duelist draws the same count, the total that was sent. The cap keeps every duelist able to draw.
function s.gytg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	Duel.SetPossibleOperationInfo(0,CATEGORY_TOGRAVE,nil,1,PLAYER_ALL,LOCATION_ONFIELD)
	Duel.SetPossibleOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,1)
	Duel.SetPossibleOperationInfo(0,CATEGORY_TODECK,nil,1,PLAYER_ALL,LOCATION_REMOVED|LOCATION_ONFIELD|LOCATION_GRAVE)
end
function s.gyop(e,tp,eg,ep,ev,re,r,rp)
	local me=aux.MPKey(tp)
	local can=aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDraw(tp_i,1) end)
	if can then
		local cap=math.huge
		aux.MPForEachDuelist(function(tp_i)
			cap=math.min(cap,Duel.GetFieldGroupCount(tp_i,LOCATION_DECK,0))
		end)
		local oc=0
		aux.MPForEachDuelist(function(tp_i,seat_i)
			if aux.MPKeyOfSeat(seat_i)==me then return end
			local g=Duel.GetMatchingGroup(Card.IsAbleToGrave,tp_i,LOCATION_ONFIELD,0,nil)
			local ct=math.min(#g,cap-oc)
			if ct>0 and Duel.SelectYesNo(tp_i,aux.Stringid(id,2)) then
				Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_TOGRAVE)
				local sg=g:Select(tp_i,1,ct,nil)
				oc=oc+Duel.SendtoGrave(sg,REASON_EFFECT,PLAYER_NONE,tp_i)
			end
		end)
		if oc>0 then
			Duel.BreakEffect()
			aux.MPForEachDuelist(function(tp_i) Duel.Draw(tp_i,oc,REASON_EFFECT) end)
		end
	end
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
	e1:SetCode(EVENT_PHASE+PHASE_END)
	e1:SetCountLimit(1)
	e1:SetOperation(s.tdop)
	e1:SetReset(RESET_PHASE|PHASE_END)
	Duel.RegisterEffect(e1,tp)
end
