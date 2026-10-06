if not Duel.MPAttackedSeat or not aux.MPAnyOpponent then return end
-- Aromage Bergamot (script fix, #215): the stock condition compares "GetLP(tp)>GetLP(1-tp)". At 3 or 4 seats 1-tp is one folded opponent
-- (the best case over all living opponents), so a richer bystander took the piercing damage away from a poorer opponent that was attacked.
-- Rulebook v1.4 (Continuous effects): your Plant monsters only deal piercing damage to opponents whose LP are lower than yours.
-- The pierce only counts in battle, so the condition looks at the opponent that the current attack goes at (Duel.MPAttackedSeat, a real
-- seat) and compares your LP with the LP of that opponent only. No pick: it is a continuous effect that applies to every opponent that
-- fulfills the condition. The own LP is read before the loop (aux.MPAnyOpponent). No attack means no piercing.
function s.pccon(e)
	local tp=e:GetHandlerPlayer()
	local attacked=Duel.MPAttackedSeat()
	if attacked==nil then return false end
	local own=Duel.GetLP(tp)
	return aux.MPAnyOpponent(tp,function(tp_i,seat_i) return seat_i==attacked and own>Duel.GetLP(tp_i) end)
end
