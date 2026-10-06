-- A declared side opponent shares no column with the summoned monster.
if not aux.MPColumnGeometry then return end
local mp_spop=s.spop
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	if not aux.MPColumnGeometry() then return mp_spop(e,tp,eg,ep,ev,re,r,rp) end
	if Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
	local tc=Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp):GetFirst()
	if tc and Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP) then
		local seq=tc:GetSequence()
		local nseq=4-seq
		if Duel.CheckLocation(1-tp,LOCATION_MZONE,nseq)
			and Duel.MPSeat(1-tp)==aux.MPColumnPeerSeat(Duel.MPSeatOf(tc)) then
			local e1=Effect.CreateEffect(e:GetHandler())
			e1:SetType(EFFECT_TYPE_FIELD)
			e1:SetCode(EFFECT_DISABLE_FIELD)
			e1:SetRange(LOCATION_SZONE)
			e1:SetLabel(nseq+16)
			e1:SetOperation(s.disop)
			e1:SetReset(RESET_PHASE|PHASE_END)
			Duel.RegisterEffect(e1,tp)
		end
	end
end

-- R-FFA-THREE-COLUMNS: choose the column opponent before cards or zones.
if aux.MPColumnEffects then
	s.initial_effect=aux.MPColumnEffects(s.initial_effect,{s.spop})
end
