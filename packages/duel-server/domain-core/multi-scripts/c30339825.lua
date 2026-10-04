if not Duel.MPActionSeat then return end
if not aux.MPForEachController then return end
-- R-TAG-SHARED-CARDS: query the owner team field. Count zones and summon at the real owner seat.
local function mp_desfilter(c,water,seat,p)
	return aux.MPKeyOfSeat(Duel.MPSeatOf(c))==aux.MPKeyOfSeat(seat)
		and Duel.GetMZoneCount(p,c)>0
		and (water or (c:IsAttribute(ATTRIBUTE_WATER) and c:IsFaceup()))
end
function s.spfilter(c,e,tp,water)
	local actor=Duel.MPActionSeat()
	if water and not c:IsAttribute(ATTRIBUTE_WATER) then return false end
	local ok=false
	aux.MPForEachController(Group.FromCards(c),function(g,seat,p)
		ok=c:IsCanBeSpecialSummoned(e,0,actor,false,false,POS_FACEUP_DEFENSE,p)
			and Duel.IsExistingMatchingCard(mp_desfilter,p,LOCATION_MZONE,0,1,nil,water,seat,p)
	end)
	return ok
end
function s.spop(water)
	return function(e,tp,eg,ep,ev,re,r,rp)
	local actor=Duel.MPActionSeat()
		local tc=Duel.GetFirstTarget()
		if not tc:IsRelateToEffect(e) then return end
		aux.MPForEachController(Group.FromCards(tc),function(cards,seat,p)
			Duel.Hint(HINT_SELECTMSG,actor,HINTMSG_DESTROY)
			local g=Duel.SelectMatchingCard(actor,mp_desfilter,p,LOCATION_MZONE,0,1,1,nil,water,seat,p)
			if #g==0 then return end
			Duel.HintSelection(g)
			if Duel.Destroy(g,REASON_EFFECT)>0 then
				Duel.SpecialSummon(tc,0,actor,p,false,false,POS_FACEUP_DEFENSE)
			end
		end)
	end
end
