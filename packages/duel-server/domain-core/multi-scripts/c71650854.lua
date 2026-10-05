if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return Duel.IsTurnPlayer(tp) and (Duel.IsMainPhase())
		and (not Duel.CheckPhaseActivity() or (Duel.GetFlagEffect(tp,CARD_MAGICAL_MIDBREAKER)>0 and Duel.MPChainCount()==1))
end
