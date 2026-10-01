if not aux.MPForEachDuelist then return end
-- Every duelist gains 1000 LP (R1, Q3, Tag partner included).
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i) Duel.Recover(tp_i,1000,REASON_EFFECT) end)
end
