if not aux.MPAny then return end
-- Balance of Judgment: the condition asks if any one opponent controls more cards than you have. The target and the operation read that count on the bound opponent.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAny(function()
		local t=Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD)
		local s=Duel.GetFieldGroupCount(tp,LOCATION_HAND|LOCATION_ONFIELD,0)
		return t>s
	end)()
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	local t=aux.MPValue(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD) end)()
	local s=Duel.GetFieldGroupCount(tp,LOCATION_HAND|LOCATION_ONFIELD,0)
	if chk==0 then return Duel.IsPlayerCanDraw(tp,t-s) end
	Duel.SetTargetPlayer(tp)
	Duel.SetTargetParam(t-s)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,t-s)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local p=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)
	local t=aux.MPValue(function() return Duel.GetFieldGroupCount(p,0,LOCATION_ONFIELD) end)()
	local s=Duel.GetFieldGroupCount(p,LOCATION_HAND|LOCATION_ONFIELD,0)
	if t>s then
		Duel.Draw(p,t-s,REASON_EFFECT)
	end
end
