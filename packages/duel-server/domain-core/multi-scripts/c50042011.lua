if not aux.MPKey then return end
local function mp_seats()
	local seats={}
	aux.MPForEachDuelist(function(tp_i,seat_i) seats[#seats+1]=seat_i end)
	return seats
end
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	local g=eg:Filter(s.checkfilter,nil)
	if #g==0 then return end
	for _,seat in ipairs(mp_seats()) do
		if g:IsExists(Card.IsPreviousControler,1,nil,seat) and not Duel.HasFlagEffect(seat,id) then
			Duel.RegisterFlagEffect(seat,id,RESET_PHASE|PHASE_END,0,1)
		end
	end
end
