if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.target1(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	e:SetLabel(0)
	local ct=Duel.MPPreviousChain()
	if ct==0 or not Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsType,TYPE_XYZ),tp,LOCATION_MZONE,0,1,nil)
		or not Duel.IsExistingMatchingCard(Card.IsDiscardable,tp,LOCATION_HAND,0,1,nil) then return false end
	local pe=Duel.GetChainInfo(ct,CHAININFO_TRIGGERING_EFFECT)
	local tc=pe:GetHandler()
	if pe:IsActiveType(TYPE_EFFECT) and tc:IsLevelAbove(5)
		and Duel.IsChainDisablable(ct) and Duel.SelectYesNo(tp,aux.Stringid(id,1)) then
		Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)
		Duel.SetOperationInfo(0,CATEGORY_DISABLE,tc,1,0,0)
		if tc:IsRelateToEffect(pe) then
			Duel.SetOperationInfo(0,CATEGORY_DESTROY,tc,1,0,0)
		end
		e:SetLabel(ct)
		e:GetHandler():RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)
	end
end
function s.activate1(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if e:GetLabel()==0 or not c:IsRelateToEffect(e) then return end
	local ct=e:GetLabel()
	local te=Duel.GetChainInfo(ct,CHAININFO_TRIGGERING_EFFECT)
	if not te then return end
	local tc=te:GetHandler()
	if Duel.NegateEffect(ct) and tc:IsRelateToEffect(te) then
		Duel.Destroy(tc,REASON_EFFECT)
	end
end
