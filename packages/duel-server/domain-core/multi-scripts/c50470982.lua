if not aux.MPForEachDuelist then return end
-- Every duelist tosses a coin and gains or loses 2000 LP (R1, Q3, Tag partner included), the duelist that runs the effect first.
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i)
		local res=Duel.TossCoin(tp_i,1)
		if res==COIN_HEADS then Duel.Recover(tp_i,2000,REASON_EFFECT)
		elseif res==COIN_TAILS then Duel.Damage(tp_i,2000,REASON_EFFECT) end
	end)
end
