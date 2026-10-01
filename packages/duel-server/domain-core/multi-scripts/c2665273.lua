if not aux.MPForEachDuelist then return end
-- Every duelist draws 1 card, then every duelist that drew attaches 1 of its own cards to this card (R1, Q3, Tag partner included).
-- `drew` is kept per real seat. The target needs every duelist to be able to draw.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDraw(tp_i,1) end) end
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,1)
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	local drew={}
	local pc=false
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if Duel.Draw(tp_i,1,REASON_EFFECT)>0 then
			drew[seat_i]=true
			pc=true
		end
	end)
	if not (pc and c:IsRelateToEffect(e) and c:IsFaceup()) then return end
	Duel.BreakEffect()
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if not drew[seat_i] then return end
		Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_ATTACH)
		local tc=Duel.SelectMatchingCard(tp_i,Card.IsCanBeXyzMaterial,tp_i,LOCATION_HAND|LOCATION_ONFIELD,0,1,1,c,c,tp,REASON_EFFECT):GetFirst()
		if tc then
			tc:CancelToGrave()
			Duel.Overlay(c,tc,true)
		end
	end)
end
