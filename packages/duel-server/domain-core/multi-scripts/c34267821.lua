if not aux.MPKey then return end
-- A resolved Lancea blocks every holder until the End Phase. In FFA the stock flag 0 reaches only the resolving seat.
local mp_rmop=s.rmop
function s.rmop(e,tp,eg,ep,ev,re,r,rp)
	mp_rmop(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i,seat_i)
		Duel.RegisterFlagEffect(tp_i,id,RESET_PHASE|PHASE_END,0,1)
	end)
end
