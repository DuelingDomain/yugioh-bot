if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.target1(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	e:SetLabel(0)
	local ct=Duel.MPPreviousChain()
	if ct==0 then return end
	local te=Duel.GetChainInfo(ct,CHAININFO_TRIGGERING_EFFECT)
	local tc=te:GetHandler()
	if te:GetCode()==EVENT_SUMMON_SUCCESS and te:IsMonsterEffect() and Duel.IsChainNegatable(ct)
		and Duel.IsPlayerCanDraw(tc:GetControler(),1) and Duel.SelectYesNo(tp,aux.Stringid(id,1)) then
		e:SetLabel(ct)
		Duel.SetOperationInfo(0,CATEGORY_NEGATE,tc,1,0,0)
		Duel.SetTargetPlayer(tc:GetControler())
		Duel.SetTargetParam(1)
		Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tc:GetControler(),1)
		e:GetHandler():RegisterFlagEffect(0,RESET_CHAIN,EFFECT_FLAG_CLIENT_HINT,1,0,aux.Stringid(id,2))
	end
end
function s.activate1(e,tp,eg,ep,ev,re,r,rp)
	if e:GetLabel()==0 then return end
	local ct=e:GetLabel()
	if not Duel.NegateActivation(ct) then return end
	local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
	Duel.Draw(p,d,REASON_EFFECT)
end
