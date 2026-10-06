-- Kuriboh: either Tag partner may prevent the team's battle damage.
-- GetBattleDamage(tp) reads one seat, while the Tag team's LP is shared.
if not aux.MPForEachDuelist then return end
local stock_con=s.con
function s.con(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()~=2 then return stock_con(e,tp,eg,ep,ev,re,r,rp) end
	local team=aux.MPKey(tp)
	return aux.MPAnyDuelist(function(tp_i,seat_i)
		return aux.MPKeyOfSeat(seat_i)==team and stock_con(e,tp_i,eg,ep,ev,re,r,rp)
	end)
end

-- Player-target effects also attach to one seat. Protect both seats of the team.
local stock_op=s.op
function s.op(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()~=2 then return stock_op(e,tp,eg,ep,ev,re,r,rp) end
	local team=aux.MPKey(tp)
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if aux.MPKeyOfSeat(seat_i)==team then stock_op(e,tp_i,eg,ep,ev,re,r,rp) end
	end)
end
