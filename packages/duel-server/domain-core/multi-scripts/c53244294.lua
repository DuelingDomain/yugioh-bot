if not aux.MPAny then return end
-- Number 57: Tri-Head Dust Dragon: the ignition condition asks if any one opponent controls more cards.
function s.zcon(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD)>Duel.GetFieldGroupCount(tp,LOCATION_ONFIELD,0) end)()
end
