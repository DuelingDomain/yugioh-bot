if not aux.MPKey then return end
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	for sc in eg:Iter() do
		Duel.RegisterFlagEffect(sc:GetSummonPlayer(),id,RESET_PHASE|PHASE_END,0,1)
	end
end
