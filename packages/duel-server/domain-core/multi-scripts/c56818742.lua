-- FFA4 geometry reads keep their temporary across view separate from the event opponent.
function s.drwcon(e,tp,eg,ep,ev,re,r,rp)
	local zone=aux.MPGeometryLinkedZone(e:GetHandler())
	return eg:IsExists(s.cfilter,1,nil,tp,zone,e:GetLabel())
end
s.cfilter=aux.MPGeometryPreviousFilter(s.cfilter)
