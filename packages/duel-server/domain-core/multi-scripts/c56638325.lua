if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.limop(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPChainCount()==0 then
		Duel.SetChainLimitTillChainEnd(s.chainlm)
	elseif Duel.MPChainCount()==1 then
		e:GetHandler():RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)
	end
end
