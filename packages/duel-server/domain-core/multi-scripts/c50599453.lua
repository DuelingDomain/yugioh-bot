if not aux.MPAny then return end
-- Leafplace Plaice: the trigger asks if any one opponent has more cards in the Graveyard (condition and target chk==0).
-- The value has no chain link, so no opponent is bound: FFA uses the opponent with the most cards in the Graveyard.
function s.spcon(e,tp,eg,ep,ev,re,r,rp)
	return Duel.IsTurnPlayer(tp)
		and aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_GRAVE)>Duel.GetFieldGroupCount(tp,LOCATION_GRAVE,0) end)()
end
function s.sptg(e,tp,eg,ep,ev,re,r,rp,chk)
	local c=e:GetHandler()
	if chk==0 then return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_GRAVE)>Duel.GetFieldGroupCount(tp,LOCATION_GRAVE,0) end)()
		and Duel.GetLocationCount(tp,LOCATION_MZONE)>0
		and c:IsCanBeSpecialSummoned(e,0,tp,false,false) end
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,0)
end
function s.incval(e)
	local tp=e:GetHandlerPlayer()
	if Duel.MPMode()~=1 then return Duel.GetFieldGroupCount(tp,0,LOCATION_GRAVE)*200 end
	local ct=0
	for i=1,Duel.MPOppCount() do
		Duel.MPWindow(i)
		ct=math.max(ct,Duel.GetFieldGroupCount(tp,0,LOCATION_GRAVE))
		Duel.MPWindowEnd()
	end
	return ct*200
end
