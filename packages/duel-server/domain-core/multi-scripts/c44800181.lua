if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.chop(e,tp,eg,ep,ev,re,r,rp)
	if Duel.IsPhase(PHASE_MAIN1) and Duel.IsTurnPlayer(tp) and Duel.MPChainCount()>1
		and e:GetHandler():GetFlagEffect(id)==0 then
		e:GetHandler():RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)
	end
end
