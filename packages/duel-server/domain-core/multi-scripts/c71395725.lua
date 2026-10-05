if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.chop(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPChainCount()==1 then
		e:SetLabel(0)
	else
		e:SetLabel(1)
	end
end
