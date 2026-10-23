if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- Owner ruling 2026-10-23: reuse the stock activation's chosen opponent.
-- If that opponent is eliminated before the ATK option, use the approved maximum.
function s.atkop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not (c:IsRelateToEffect(e) and c:IsFaceup()) then return end
	local own=Duel.GetLP(tp)
	local other
	if Duel.MPBound() then other=Duel.MPGetLP(Duel.MPSeat(1-tp)) end
	if not other then
		local seat
		seat,other=aux.MPHighestLPOpponent(aux.MPKey(tp))
		if seat~=nil then Duel.MPBindSeat(seat) end
	end
	if Duel.MPBound() then aux.MPLPOpponentHint(c,Duel.MPSeat(1-tp)) end
	local diff=math.abs(own-other)
	if diff==0 then return end
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_SINGLE)
	e1:SetCode(EFFECT_UPDATE_ATTACK)
	e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
	e1:SetRange(LOCATION_MZONE)
	e1:SetValue(math.floor(diff/2))
	e1:SetReset(RESETS_STANDARD_PHASE_END)
	c:RegisterEffect(e1)
	local e2=Effect.CreateEffect(c)
	e2:SetType(EFFECT_TYPE_FIELD)
	e2:SetCode(EFFECT_CANNOT_ATTACK)
	e2:SetTargetRange(LOCATION_MZONE,0)
	e2:SetTarget(s.ftarget)
	e2:SetLabel(c:GetFieldID())
	e2:SetReset(RESET_PHASE|PHASE_END)
	Duel.RegisterEffect(e2,tp)
	aux.RegisterClientHint(c,nil,tp,1,0,aux.Stringid(id,3),nil)
end

-- Retain stock activation probing (GetLP marks the chosen-opponent read).
-- Narrow both the destruction check and operation to that same field.
s.destg=aux.MPTarget(s.destg)
s.desop=aux.MPOne(s.desop)
local mp_target=s.target
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk~=0 and Duel.MPBound() then aux.MPLPOpponentHint(e:GetHandler(),Duel.MPSeat(1-tp)) end
	return mp_target(e,tp,eg,ep,ev,re,r,rp,chk)
end
function s.atktg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		Duel.GetLP(1-tp) -- Preserve the core's activation-probe dependency.
		local other=Duel.MPBound() and Duel.MPGetLP(Duel.MPSeat(1-tp))
		if not other then local seat; seat,other=aux.MPHighestLPOpponent(aux.MPKey(tp)) end
		return e:GetHandler():IsRelateToEffect(e) and Duel.GetLP(tp)~=other
	end
end
