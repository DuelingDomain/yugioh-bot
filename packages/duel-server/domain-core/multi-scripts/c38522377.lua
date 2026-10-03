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
function s.damtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	e:SetLabel(mp_mask(eg:Filter(Card.IsType,nil,TYPE_SYNCHRO)))
	Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,PLAYER_ALL,1000)
end
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	mp_each_side(e:GetLabel(),function(tp_i) Duel.Damage(tp_i,1000,REASON_EFFECT,true) end)
	Duel.RDComplete()
end
