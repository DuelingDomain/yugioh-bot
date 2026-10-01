if not aux.MPAny then return end
-- Traptrix Pudica (the banish effect): the target asks the activator for the opponent. The Standby Phase effect belongs to the controller of the banished monster.
-- Its REAL seat (Duel.MPSeatOf: in Tag the duelist, not the team) is saved in the effect value when the monster is banished. The stock script reads "1-tp",
-- and a folded value saved in the effect would mean another duelist in the Standby Phase. In the Standby Phase Duel.MPBindSeat makes "1" that seat again:
-- a seat that is dead by then, or not an opponent, gives an empty other side (no offer, no Lua error).
s.rmtg=aux.MPTarget(s.rmtg)
function s.mpspfilter(c,e,p)
	return c:IsCanBeSpecialSummoned(e,0,p,false,false)
end
function s.rmop(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	local op=Duel.MPSeatOf(tc)
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
	Duel.MPBindSeat(e:GetValue())
	return Duel.IsExistingMatchingCard(s.mpspfilter,1,LOCATION_REMOVED,0,1,nil,e,1) and (label==0 or label~=Duel.GetTurnCount())
end
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	Duel.MPBindSeat(e:GetValue())
	local g=Duel.GetMatchingGroup(s.mpspfilter,1,LOCATION_REMOVED,0,nil,e,1)
	if #g==0 or not Duel.SelectYesNo(1,aux.Stringid(id,3)) then return end
	Duel.Hint(HINT_SELECTMSG,1,HINTMSG_SPSUMMON)
	local sg=g:Select(1,1,1,nil)
	if #sg>0 then
		Duel.SpecialSummon(sg,0,1,1,false,false,POS_FACEUP)
	end
end
