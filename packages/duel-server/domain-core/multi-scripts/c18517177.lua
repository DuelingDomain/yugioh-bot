if not aux.MPAny then return end
-- Core Blast: the trigger asks if any one opponent controls more monsters (descon and target chk==0).
-- The count and the pool of cards to destroy are read on the bound opponent.
function s.descon(e,tp,eg,ep,ev,re,r,rp)
	return Duel.IsTurnPlayer(tp)
		and aux.MPAny(function() return Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)<Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end)()
		and Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_KOAKI_MEIRU),tp,LOCATION_MZONE,0,1,nil)
end
function s.destg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)<Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end)() end
	local g=aux.MPValue(function() return Duel.GetMatchingGroup(aux.TRUE,tp,0,LOCATION_ONFIELD,nil) end)()
	local ct=aux.MPValue(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)-Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0) end)()
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,ct,0,0)
end
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	if not e:GetHandler():IsRelateToEffect(e) then return end
	local g=aux.MPValue(function() return Duel.GetMatchingGroup(aux.TRUE,tp,0,LOCATION_ONFIELD,nil) end)()
	local ct=#g-Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)
	if ct<=0 then return end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
	local dg=g:Select(tp,ct,ct,nil)
	Duel.Destroy(dg,REASON_EFFECT)
end
