if not aux.MPForEachController then return end
-- FFA declares one opponent at activation and saves that seat for the End Phase.
-- The first position change still affects every field. Tag flips and draws per opposing member.
local eclipse_target=s.target
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if Duel.MPMode()==1 then
		if chk==0 then Duel.MPNeedPick() else Duel.MPBindOpponent(true) end
	end
	return eclipse_target(e,tp,eg,ep,ev,re,r,rp,chk)
end
local eclipse_activate=s.activate
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()~=1 then return eclipse_activate(e,tp,eg,ep,ev,re,r,rp) end
	local opponent=Duel.MPSeat(1-tp)
	local g=Duel.GetMatchingGroup(Card.IsCanTurnSet,tp,LOCATION_MZONE,LOCATION_MZONE,nil)
	if #g>0 then Duel.ChangePosition(g,POS_FACEDOWN_DEFENSE) end
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
	e1:SetCode(EVENT_PHASE+PHASE_END)
	e1:SetCountLimit(1)
	e1:SetReset(RESET_PHASE|PHASE_END)
	e1:SetLabel(opponent)
	e1:SetCondition(s.flipcon)
	e1:SetOperation(s.flipop)
	Duel.RegisterEffect(e1,tp)
end
local eclipse_flipcon=s.flipcon
function s.flipcon(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()~=1 then return eclipse_flipcon(e,tp,eg,ep,ev,re,r,rp) end
	if not Duel.MPBindSeat(e:GetLabel()) then return false end
	Duel.MPWindow(0)
	local result=eclipse_flipcon(e,tp,eg,ep,ev,re,r,rp)
	Duel.MPWindowEnd()
	Duel.MPBindSeat()
	return result
end
function s.flipop(e,tp,eg,ep,ev,re,r,rp)
	local ffa=Duel.MPMode()==1
	if ffa then
		if not Duel.MPBindSeat(e:GetLabel()) then return end
		Duel.MPWindow(0)
	end
	local g=Duel.GetMatchingGroup(Card.IsFacedown,tp,0,LOCATION_MZONE,nil)
	local ct=Duel.ChangePosition(g,POS_FACEUP_DEFENSE)
	if ffa then
		Duel.Draw(1-tp,ct,REASON_EFFECT)
		Duel.MPWindowEnd()
		Duel.MPBindSeat()
	else
		aux.MPForEachController(Duel.GetOperatedGroup(),function(sg,seat,p)
			Duel.Draw(p,#sg,REASON_EFFECT)
		end)
	end
end
