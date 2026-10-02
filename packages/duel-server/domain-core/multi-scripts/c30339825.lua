if not aux.MPForEachController then return end
-- In a GY the controller is the owner. Query that owner's field and return to that real seat.
local function mp_desfilter(c,water,seat)
	return (Duel.MPMode()==2 or Duel.MPSeatOf(c)==seat) and s.desfilter(c,water)
end
function s.spfilter(c,e,tp,water)
	if water and not c:IsAttribute(ATTRIBUTE_WATER) then return false end
	local ok=false
	aux.MPForEachController(Group.FromCards(c),function(g,seat,p)
		ok=c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP_DEFENSE,p)
			and Duel.IsExistingMatchingCard(mp_desfilter,p,LOCATION_MZONE,0,1,nil,water,seat)
	end)
	return ok
end
function s.spop(water)
	return function(e,tp,eg,ep,ev,re,r,rp)
		local tc=Duel.GetFirstTarget()
		if not tc:IsRelateToEffect(e) then return end
		aux.MPForEachController(Group.FromCards(tc),function(cards,seat,p)
			Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
			local g=Duel.SelectMatchingCard(tp,mp_desfilter,p,LOCATION_MZONE,0,1,1,nil,water,seat)
			if #g==0 then return end
			Duel.HintSelection(g)
			if Duel.Destroy(g,REASON_EFFECT)>0 then
				Duel.SpecialSummon(tc,0,tp,p,false,false,POS_FACEUP_DEFENSE)
			end
		end)
	end
end
