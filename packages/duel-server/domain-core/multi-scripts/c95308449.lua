if not aux.MPKey then return end
local function mp_seats()
	local seats={}
	aux.MPForEachDuelist(function(tp_i,seat_i) seats[#seats+1]=seat_i end)
	return seats
end
local function mp_effects(tp)
	local list,seen={},{}
	for _,seat in ipairs(mp_seats()) do
		for _,te in ipairs({Duel.GetPlayerEffect(seat,id)}) do
			if not seen[te] then seen[te]=true list[#list+1]=te end
		end
	end
	return list
end
function s.endop(e,tp,eg,ep,ev,re,r,rp)
	for _,te in ipairs(mp_effects(tp)) do
		s.checkop(te,te:GetOwnerPlayer(),nil,0,0,nil,0,0)
	end
	s.winop(e,tp,eg,ep,ev,re,r,rp)
end
function s.winop(e,tp,eg,ep,ev,re,r,rp)
	local t,seat_of={},{}
	local any=false
	for _,te in ipairs(mp_effects(tp)) do
		local p=te:GetOwnerPlayer()
		if te:GetValue()==20 then
			local k=aux.MPKey(p)
			t[k]=(t[k] or 0)+1
			seat_of[k]=p
			any=true
			if te:GetLabel()+1==3 then te:Reset() end
		end
	end
	if not any then return end
	local best,winner,tie=-1,nil,false
	for k,n in pairs(t) do
		if n>best then best=n winner=seat_of[k] tie=false
		elseif n==best then tie=true end
	end
	if tie then
		Duel.Win(PLAYER_NONE,WIN_REASON_FINAL_COUNTDOWN)
	else
		Duel.Win(winner,WIN_REASON_FINAL_COUNTDOWN)
	end
end
