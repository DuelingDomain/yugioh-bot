if not aux.MPForEachDuelist then return end
-- Every duelist draws until it has 6 cards in hand (R1, Q3, Tag partner included). The target needs every duelist to draw at least 1 card.
-- The number to draw is kept per real seat. The "Monster Reborn" effect stays stock.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	local total=0
	local ok=aux.MPAllDuelists(function(tp_i)
		local ct=6-Duel.GetMatchingGroupCount(nil,tp_i,LOCATION_HAND,0,e:GetHandler())
		if ct>0 then total=total+ct end
		return ct>0 and Duel.IsPlayerCanDraw(tp_i,ct)
	end)
	if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
		and Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_GRAVE,0,1,nil,e,tp)
		and ok end
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_GRAVE)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,total)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	if Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
	local g=Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)
	if #g>0 and Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)>0 then
		local cts={}
		local need=false
		local can=false
		aux.MPForEachDuelist(function(tp_i,seat_i)
			local ct=6-Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0)
			cts[seat_i]=ct
			if ct>0 then need=true end
			if Duel.IsPlayerCanDraw(tp_i) then can=true end
		end)
		if not need or not can then return end
		Duel.BreakEffect()
		aux.MPForEachDuelist(function(tp_i,seat_i)
			if cts[seat_i]>0 then
				Duel.Draw(tp_i,cts[seat_i],REASON_EFFECT)
			end
		end)
	end
end
