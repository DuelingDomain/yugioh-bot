if not aux.MPGeometryPreviousFilter then return end

s.cfilter=aux.MPGeometryPreviousFilter(s.cfilter)

function s.regcon(e,tp,eg,ep,ev,re,r,rp)
	return eg:IsExists(s.cfilter,1,nil,tp,aux.MPGeometryLinkedZone(e:GetHandler()))
end
function s.regcon2(e,tp,eg,ep,ev,re,r,rp)
	return eg:IsExists(s.cfilter2,1,nil,tp,aux.MPGeometryLinkedZone(e:GetHandler()))
end
