if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.chop(e,tp,eg,ep,ev,re,r,rp)
	local ct=Duel.MPChainCount()
	if ct==1 then
		e:SetLabel(0)
	elseif not Duel.CheckChainUniqueness() then
		e:SetLabel(2)
	elseif ct>=3 and e:GetLabel()~=2 then
		e:SetLabel(1)
	end
end
