if not aux.MPKey then return end
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	local player=eg:GetFirst():GetControler()
	if aux.MPKey(ep)~=aux.MPKey(player) then
		Duel.RegisterFlagEffect(player,id,RESET_PHASE|PHASE_DAMAGE,0,1)
	end
end
