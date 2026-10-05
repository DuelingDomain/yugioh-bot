if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	local e2=e:GetLabelObject()
	if Duel.MPChainCount()==1 then e2:SetLabelObject({}) end
	if re:IsActiveType(TYPE_PENDULUM) and c:GetLinkedGroup():IsContains(re:GetHandler()) then
		e2:GetLabelObject()[re:GetFieldID()]=c:GetFieldID()
	end
end
