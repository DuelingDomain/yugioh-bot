if not aux.MPForEachController then return end
-- FFA declares one opponent when the flip effect enters the chain and saves that seat for the End Phase.
-- Tag keeps both opposing fields and shared damage. No later operation asks for an opponent.
local astromorrigan_initial_effect=s.initial_effect
function s.initial_effect(c)
	if Duel.MPMode()~=1 then return astromorrigan_initial_effect(c) end
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)
	e1:SetTarget(s.declare_target)
	e1:SetOperation(s.flipop)
	c:RegisterEffect(e1)
end
function s.declare_target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then Duel.MPNeedPick() return true end
	Duel.MPBindOpponent(true)
end
local astromorrigan_flipop=s.flipop
function s.flipop(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()~=1 then return astromorrigan_flipop(e,tp,eg,ep,ev,re,r,rp) end
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
	e1:SetCode(EVENT_PHASE+PHASE_END)
	e1:SetCountLimit(1)
	e1:SetLabel(Duel.MPSeat(1-tp))
	e1:SetOperation(s.desop)
	e1:SetReset(RESET_PHASE|PHASE_END)
	Duel.RegisterEffect(e1,tp)
end
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	local ffa=Duel.MPMode()==1
	if ffa then
		if not Duel.MPBindSeat(e:GetLabel()) then return end
		Duel.MPWindow(0)
	end
	local g=Duel.GetMatchingGroup(s.desfilter,tp,0,LOCATION_MZONE,nil)
	if #g>0 then
		Duel.Hint(HINT_CARD,0,id)
		if ffa then
			local ct=Duel.Destroy(g,REASON_EFFECT)
			Duel.Damage(1-tp,ct*500,REASON_EFFECT)
		else
			aux.MPForEachController(g,function(sg,seat,p)
				local ct=Duel.Destroy(sg,REASON_EFFECT)
				Duel.Damage(p,ct*500,REASON_EFFECT)
			end)
		end
	end
	if ffa then
		Duel.MPWindowEnd()
		Duel.MPBindSeat()
	end
end
