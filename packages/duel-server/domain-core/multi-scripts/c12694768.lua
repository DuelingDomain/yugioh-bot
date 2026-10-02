if not aux.MPForEachDuelist then return end
-- Every duelist takes 500 damage (R1, Q3, Tag partner included).
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,500,REASON_EFFECT,true) end)
	Duel.RDComplete()
end
