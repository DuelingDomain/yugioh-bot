if not aux.MPForEachDuelist then return end
-- Criosphinx: the event value keeps the real seats of the returned owners. Each such duelist discards once.
function s.regop(e,tp,eg,ep,ev,re,r,rp)
	local mask=0
	for c in aux.Next(eg) do
		if c:IsPreviousLocation(LOCATION_MZONE) and c:IsMonster() then
			local seat=Duel.MPSeatOf(c)
			if seat>=0 then mask=mask|(1<<seat) end
		end
	end
	if mask~=0 then
		Duel.RaiseSingleEvent(e:GetHandler(),EVENT_CUSTOM+id,re,r,rp,PLAYER_ALL,mask)
	end
end
function s.hdtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return e:GetHandler():IsRelateToEffect(e) end
	Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,PLAYER_ALL,LOCATION_HAND)
end
function s.hdop(e,tp,eg,ep,ev,re,r,rp)
	if not e:GetHandler():IsRelateToEffect(e) or e:GetHandler():IsFacedown() then return end
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if (ev&(1<<seat_i))~=0 then Duel.DiscardHand(tp_i,nil,1,1,REASON_EFFECT) end
	end)
end
