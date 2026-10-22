if Duel.MPMode()~=1 then return end
-- R-FFA-LP-COMPARE: unanimous living-opponent conditions; stock amounts/actions.
function s.destg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsFaceup() and chkc:IsType(TYPE_EXTRA) end
	if chk==0 then return Duel.IsExistingTarget(aux.FaceupFilter(Card.IsType,TYPE_EXTRA),tp,LOCATION_MZONE,LOCATION_MZONE,1,nil) end
	local ct=(aux.MPCompareLP(tp,"<")) and 2 or 1
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
	local g=Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsType,TYPE_EXTRA),tp,LOCATION_MZONE,LOCATION_MZONE,1,ct,nil)
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)
	--Register that this effect was activated this turn
	e:GetHandler():RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,EFFECT_FLAG_OATH,1)
end
