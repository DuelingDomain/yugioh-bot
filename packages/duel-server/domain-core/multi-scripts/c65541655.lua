if not aux.MPKey then return end
local function mp_seats()
	local seats={}
	aux.MPForEachDuelist(function(tp_i,seat_i) seats[#seats+1]=seat_i end)
	return seats
end
function s.regop(e,tp,eg,ep,ev,re,r,rp)
	local seats=mp_seats()
	local done=true
	for _,seat in ipairs(seats) do
		if not Duel.HasFlagEffect(seat,id) then done=false end
	end
	if done then return end
	for _,seat in ipairs(seats) do
		if eg:IsExists(s.regopfilter,1,nil,seat) then
			Duel.RegisterFlagEffect(seat,id,0,0,1)
		end
	end
end
