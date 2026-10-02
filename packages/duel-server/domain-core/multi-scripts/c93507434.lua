if not aux.MPAny then return end
-- Dinowrestler Capaptera: the ignition condition asks if any one opponent controls more monsters.
function s.tgcon(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0) end)()
end
