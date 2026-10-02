if not aux.MPForEachDuelist then return end
-- Every duelist draws 1 card and discards 1 card (R1, Q3, Tag partner included). The seal of a Monster Zone happens if the duelist that
-- runs the effect discarded an "Ojama" card. The target needs every duelist to be able to draw. `drew` is kept per real seat.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDraw(tp_i,1) end) end
	Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,PLAYER_ALL,1)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,1)
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	local drew={}
	local any=false
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if Duel.Draw(tp_i,1,REASON_EFFECT)>0 then
			drew[seat_i]=true
			any=true
		end
	end)
	if any then Duel.BreakEffect() end
	local sealbool=false
	local first=true
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local own=first
		first=false
		if not drew[seat_i] then return end
		Duel.ShuffleHand(tp_i)
		if Duel.DiscardHand(tp_i,aux.TRUE,1,1,REASON_EFFECT|REASON_DISCARD)>0 and own then
			local dc=Duel.GetOperatedGroup():GetFirst()
			if dc:IsSetCard(SET_OJAMA) then sealbool=true end
		end
	end)
	if sealbool and Duel.GetLocationCount(1-tp,LOCATION_MZONE)>0
	and Duel.SelectYesNo(tp,aux.Stringid(id,0)) then
		Duel.BreakEffect()
		local zone=Duel.SelectDisableField(tp,1,0,LOCATION_MZONE,0)
		if tp==1 then
				zone=((zone&0xffff)<<16)|((zone>>16)&0xffff)
		end
		local e1=Effect.CreateEffect(e:GetHandler())
		e1:SetType(EFFECT_TYPE_FIELD)
		e1:SetCode(EFFECT_DISABLE_FIELD)
		e1:SetValue(zone)
		e1:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN)
		Duel.RegisterEffect(e1,tp)
	end
end
