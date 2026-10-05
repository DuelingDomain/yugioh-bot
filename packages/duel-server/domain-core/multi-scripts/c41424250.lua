if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.limop(e,tp,eg,ep,ev,re,r,rp)
	local current_chain=Duel.MPChainCount()
	if current_chain==0 then
		Duel.SetChainLimitTillChainEnd(aux.FALSE)
	elseif current_chain==1 then
		e:GetHandler():RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)
	end
end
