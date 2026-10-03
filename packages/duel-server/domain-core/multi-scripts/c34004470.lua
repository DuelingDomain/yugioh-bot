if not aux.MPForEachDuelist then return end
-- Every duelist takes the damage (R1, Q3, Tag partner included).
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local d=Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM)
	aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,d,REASON_EFFECT,true) end)
	Duel.RDComplete()
end
