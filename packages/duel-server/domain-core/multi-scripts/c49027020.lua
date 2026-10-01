if not aux.MPAny then return end
-- Traptrix Pudica (the banish effect): the target asks the activator for the opponent. The Standby Phase effect belongs to the controller of the banished monster,
-- who is saved in the effect value (op) when the monster is banished. The stock script reads "1-tp", which is not that duelist at 3 or 4 seats.
s.rmtg=aux.MPTarget(s.rmtg)
function s.mpspfilter(c,e,p)
	return c:IsCanBeSpecialSummoned(e,0,p,false,false)
end
function s.rmop(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	local op=tc:GetControler()
	if tc:IsRelateToEffect(e) then
		Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)
	end
	local c=e:GetHandler()
	--Opponent can Special Summon 1 banished monster
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
	e1:SetCode(EVENT_PHASE|PHASE_STANDBY)
	local reset,reset_ct=RESET_PHASE|PHASE_STANDBY,1
	local turn_ct=0
	if Duel.IsPhase(PHASE_STANDBY) then
		reset_ct=2
		turn_ct=Duel.GetTurnCount()
	end
	e1:SetCountLimit(1)
	e1:SetCondition(s.spcon)
	e1:SetOperation(s.spop)
	e1:SetLabel(turn_ct)
	e1:SetValue(op)
	e1:SetReset(reset,reset_ct)
	Duel.RegisterEffect(e1,tp)
	aux.RegisterClientHint(c,0,tp,0,1,aux.Stringid(id,2),reset,reset_ct)
end
function s.spcon(e,tp,eg,ep,ev,re,r,rp)
	local label=e:GetLabel()
	local op=e:GetValue()
	return Duel.IsExistingMatchingCard(s.mpspfilter,op,LOCATION_REMOVED,0,1,nil,e,op) and (label==0 or label~=Duel.GetTurnCount())
end
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	local op=e:GetValue()
	local g=Duel.GetMatchingGroup(s.mpspfilter,op,LOCATION_REMOVED,0,nil,e,op)
	if #g==0 or not Duel.SelectYesNo(op,aux.Stringid(id,3)) then return end
	Duel.Hint(HINT_SELECTMSG,op,HINTMSG_SPSUMMON)
	local sg=g:Select(op,1,1,nil)
	if #sg>0 then
		Duel.SpecialSummon(sg,0,op,op,false,false,POS_FACEUP)
	end
end
