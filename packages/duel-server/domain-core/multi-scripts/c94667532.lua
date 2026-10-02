if not aux.MPForEachDuelist then return end
-- Mecha-Dog Marron: battle destruction damages every living duelist, including the Tag partner.
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
	if p==PLAYER_ALL then
		aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,d,REASON_EFFECT,true) end)
		Duel.RDComplete()
	else
		Duel.Damage(p,d,REASON_EFFECT)
	end
end
