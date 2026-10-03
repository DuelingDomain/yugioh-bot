if not aux.MPKey then return end
-- mask: bit k set for the key k (seat in FFA, team in Tag) of a side. mp_mask(g) = the keys of the real controllers of g.
-- mp_each_side(mask,fn) runs fn(tp_i,seat_i) once for every living side whose key is in the mask (Duel.Damage(tp_i,...) hits that side).
local function mp_mask(g)
	local mask=0
	for tc in aux.Next(g) do
		local seat=Duel.MPSeatOf(tc)
		if seat>=0 then mask=mask|(1<<aux.MPKeyOfSeat(seat)) end
	end
	return mask
end
local function mp_each_side(mask,fn)
	local done={}
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local k=aux.MPKeyOfSeat(seat_i)
		if not done[k] and (mask&(1<<k))~=0 then
			done[k]=true
			fn(tp_i,seat_i)
		end
	end)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local tg=Duel.GetTargetCards(e)
	local dam=tg:Filter(Card.IsFaceup,nil):GetSum(Card.GetAttack)
	local g=Duel.GetMatchingGroup(s.desfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil,tg)
	local side_of={}
	for tc in g:Iter() do side_of[tc]=aux.MPKeyOfSeat(Duel.MPSeatOf(tc)) end
	if #g>0 and Duel.Destroy(g,REASON_EFFECT)~=0 and dam>0 then
		local dg=Duel.GetOperatedGroup()
		local mask=0
		for tc in dg:Iter() do
			if side_of[tc] and side_of[tc]>=0 then mask=mask|(1<<side_of[tc]) end
		end
		Duel.BreakEffect()
		mp_each_side(mask,function(tp_i) Duel.Damage(tp_i,dam,REASON_EFFECT,true) end)
		Duel.RDComplete()
	end
end
