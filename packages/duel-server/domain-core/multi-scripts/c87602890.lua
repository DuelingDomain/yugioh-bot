if not aux.MPForEachDuelist then return end
-- After the destroyed monster was LIGHT, every duelist sends cards from its Extra Deck equal to the Level (Rank) of that monster (R1, Q3,
-- Tag partner included). With the flag (stock text: the Tribute Summoned card had a LIGHT material) the activator looks at the Extra Deck of
-- each duelist that is not on its side and picks the cards for it. The pools are read inside the loop for the duelist that owns them, the
-- activator confirms and picks after the loop (the scope is the activator again).
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if tc and tc:IsRelateToEffect(e) then
		if Duel.Destroy(tc,REASON_EFFECT)==0 or (tc:GetPreviousAttributeOnField()&ATTRIBUTE_LIGHT)==0 then return end
		local lv=tc:GetOriginalLevel()
		if tc:IsType(TYPE_XYZ) then
			lv=tc:GetOriginalRank()
		end
		local g1=Group.CreateGroup()
		local pick_opp=e:GetHandler():GetFlagEffect(id)>0
		local me=aux.MPKey(tp)
		local pools={}
		aux.MPForEachDuelist(function(tp_i,seat_i)
			if pick_opp and aux.MPKeyOfSeat(seat_i)~=me then
				pools[#pools+1]=Duel.GetFieldGroup(tp_i,LOCATION_EXTRA,0)
			else
				Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_TOGRAVE)
				g1:Merge(Duel.SelectMatchingCard(tp_i,nil,tp_i,LOCATION_EXTRA,0,lv,lv,nil))
			end
		end)
		for _,pool in ipairs(pools) do
			Duel.ConfirmCards(tp,pool)
			Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)
			g1:Merge(pool:Select(tp,lv,lv,nil))
		end
		if #g1>0 then
			Duel.BreakEffect()
			Duel.SendtoGrave(g1,REASON_EFFECT)
		end
	end
end
