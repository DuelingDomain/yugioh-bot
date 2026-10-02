if not aux.MPForEachDuelist then return end
-- Every duelist sends face-up monsters from its field to the GY and then draws one card for each of the types it controls (R1, Q3, Tag
-- partner included). `draw` is kept per real seat. The Tag partner picks from the team side after the first partner sent its cards.
function s.tgtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		return aux.MPAnyDuelist(function(tp_i)
			for _,t in ipairs(s.types) do
				if Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsType,t),tp_i,LOCATION_MZONE,0,2,nil) then
					return true
				end
			end
			return false
		end)
	end
	Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,PLAYER_ALL,LOCATION_MZONE)
end
function s.tgop(e,tp,eg,ep,ev,re,r,rp)
	local draw={}
	local any=false
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local g=Duel.GetMatchingGroup(Card.IsFaceup,tp_i,LOCATION_MZONE,0,nil)
		for _,t in ipairs(s.types) do
			if g:FilterCount(Card.IsType,nil,t)==1 then
				g:Remove(Card.IsType,nil,t)
			end
		end
		if #g>0 then
			local tg=aux.SelectUnselectGroup(g,e,tp_i,1,99,s.cancelcon,1,tp_i,HINTMSG_TOGRAVE,s.cancelcon)
			if Duel.SendtoGrave(tg,REASON_EFFECT,PLAYER_NONE,tp_i)>0 then
				draw[seat_i]=true
				any=true
			end
		end
	end)
	if any then
		Duel.BreakEffect()
		aux.MPForEachDuelist(function(tp_i,seat_i)
			if draw[seat_i] then
				Duel.Draw(tp_i,s.typecount(tp_i),REASON_EFFECT)
			end
		end)
	end
end
