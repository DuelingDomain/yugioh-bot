if not aux.MPKey then return end
-- The global FFA protection condition needs lower LP than every living opponent.
-- Tag retains its existing team-LP path.
local mp_eqtg=s.eqtg
local function mp_target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	local result=mp_eqtg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chk~=0 then e:SetLabel(id,aux.MPKey(tp),aux.MPKey(1-tp)) end
	return result
end
s.eqtg=Duel.MPMode()==1 and aux.MPTarget(mp_target) or mp_target
function s.effectfilter(e,ct)
	local te=Duel.GetChainInfo(ct,CHAININFO_TRIGGERING_EFFECT)
	local code,own=te:GetLabel()
	if code~=id or own==nil then return false end
	if Duel.MPMode()==1 then return aux.MPCompareLPSeat(own,"<") end
	local lp=Duel.GetLP(own)
	for seat=0,3 do
		if Duel.MPIsAlive(seat) and aux.MPKeyOfSeat(seat)~=own and lp<Duel.GetLP(seat) then return true end
	end
	return false
end
