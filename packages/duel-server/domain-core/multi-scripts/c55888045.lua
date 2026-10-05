if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.negop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not c:IsRelateToEffect(e) or Duel.MPPreviousChain()~=ev or c:RemoveOverlayCard(tp,1,1,REASON_EFFECT)<1 then return end
	local g=Duel.GetMatchingGroup(Card.IsNegatable,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,c)
	g:ForEach(function(tc) tc:NegateEffects(c,RESET_PHASE|PHASE_END,true) end)
end
