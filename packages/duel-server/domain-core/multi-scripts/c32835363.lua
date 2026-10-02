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
function s.regcon(e,tp,eg,ep,ev,re,r,rp)
	local g=eg:Filter(function(tc) return tc:IsPreviousLocation(LOCATION_MZONE) and tc:IsMonster() and tc:IsReason(REASON_EFFECT) end,nil)
	local mask=mp_mask(g)
	e:SetLabel(mask)
	return mask~=0
end
function s.regop(e,tp,eg,ep,ev,re,r,rp)
	Duel.RaiseSingleEvent(e:GetHandler(),EVENT_CUSTOM+id,e,0,tp,PLAYER_ALL,e:GetLabel())
end
function s.damtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return e:GetHandler():IsRelateToEffect(e) end
	Duel.SetTargetParam(800)
	Duel.SetOperationInfo(0,CATEGORY_DAMAGE,0,0,PLAYER_ALL,800)
end
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	if not e:GetHandler():IsRelateToEffect(e) then return end
	local d=Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM)
	mp_each_side(ev,function(tp_i) Duel.Damage(tp_i,d,REASON_EFFECT,true) end)
	Duel.RDComplete()
end
