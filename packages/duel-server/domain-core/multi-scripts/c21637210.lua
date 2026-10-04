-- FFA4 geometry reads keep their temporary across view separate from the event opponent.
function s.regcon(e,tp,eg,ep,ev,re,r,rp)
	return eg:IsExists(s.cfilter,1,nil,tp,aux.MPGeometryLinkedZone(e:GetHandler()))
end
function s.regcon2(e,tp,eg,ep,ev,re,r,rp)
	return eg:IsExists(s.cfilter2,1,nil,tp,aux.MPGeometryLinkedZone(e:GetHandler()))
end
s.cfilter=aux.MPGeometryPreviousFilter(s.cfilter)
