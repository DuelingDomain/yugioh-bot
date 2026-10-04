-- FFA4 geometry reads keep their temporary across view separate from the event opponent.
function s.spcon(e,tp,eg,ep,ev,re,r,rp)
	local zone=aux.MPGeometryLinkedZone(e:GetHandler())
	return eg:IsExists(s.cfilter,1,nil,tp,zone,rp)
end
function s.sptg(e,tp,eg,ep,ev,re,r,rp,chk)
	local g=eg:Filter(s.cfilter,nil,tp,aux.MPGeometryLinkedZone(e:GetHandler()))
	local attr=0
	for tc in aux.Next(g) do
		attr=attr|tc:GetOriginalAttribute()
	end
	if chk==0 then
		return attr~=0 and Duel.GetLocationCount(tp,LOCATION_MZONE)>0
			and Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_DECK,0,1,nil,e,tp,attr)
	end
	e:SetLabel(attr)
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)
end
s.cfilter=aux.MPGeometryPreviousFilter(s.cfilter)
