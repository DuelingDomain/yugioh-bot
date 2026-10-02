if not aux.MPForEachDuelist then return end
-- Mecha-Dog Marron: battle destruction damages each living side. Tag team LP is charged once.
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
	if p==PLAYER_ALL then
		local done={}
		aux.MPForEachDuelist(function(tp_i,seat_i)
			local key=aux.MPKeyOfSeat(seat_i)
			if not done[key] then
				done[key]=true
				Duel.Damage(tp_i,d,REASON_EFFECT,true)
			end
		end)
		Duel.RDComplete()
	else
		Duel.Damage(p,d,REASON_EFFECT)
	end
end
