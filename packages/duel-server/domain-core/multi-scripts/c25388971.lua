if not aux.MPAny then return end
-- Sangen Kaiho: the activation condition asks if any one opponent controls more monsters than you.
function s.phcon(e,tp,eg,ep,ev,re,r,rp)
	if not Duel.IsMainPhase() then return false end
	local g=Duel.GetFieldGroup(tp,LOCATION_MZONE,0)
	return #g>0 and g:FilterCount(s.phconfilter,nil)==#g
		and aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>#g end)()
end
