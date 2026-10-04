if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- FFA Swords protects its controller. Tag and 1v1 keep the stock script.
function s.initial_effect(c)
	--Activate
	local e1=Effect.CreateEffect(c)
	e1:SetCategory(CATEGORY_POSITION)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetTarget(s.target)
	e1:SetOperation(s.activate)
	c:RegisterEffect(e1)
	--Protect the controller monsters, including face-down monsters.
	local e2=Effect.CreateEffect(c)
	e2:SetType(EFFECT_TYPE_FIELD)
	e2:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)
	e2:SetProperty(EFFECT_FLAG_SET_AVAILABLE)
	e2:SetRange(LOCATION_SZONE)
	e2:SetTargetRange(LOCATION_MZONE,0)
	e2:SetValue(s.mpopponent)
	c:RegisterEffect(e2)
	--Protect the controller from direct attacks.
	local e4=Effect.CreateEffect(c)
	e4:SetType(EFFECT_TYPE_FIELD)
	e4:SetCode(EFFECT_CANNOT_BE_DIRECT_ATTACKED)
	e4:SetProperty(EFFECT_FLAG_PLAYER_TARGET|EFFECT_FLAG_SET_AVAILABLE)
	e4:SetRange(LOCATION_SZONE)
	e4:SetTargetRange(1,0)
	c:RegisterEffect(e4)
	--remain field
	local e3=Effect.CreateEffect(c)
	e3:SetType(EFFECT_TYPE_SINGLE)
	e3:SetCode(EFFECT_REMAIN_FIELD)
	c:RegisterEffect(e3)
end
function s.mpopponent(e,c)
	return c:GetControler()~=e:GetHandlerPlayer()
end
-- Select every face-down monster outside the controller's field.
-- Both ranges are queried; the filter excludes the controller. No declaration is needed.
function s.mpflipfilter(c,tp)
	return c:IsFacedown() and not c:IsControler(tp)
end
function s.mpflip(i,e,tp,eg,ep,ev,re,r,rp)
	local sg=Duel.GetMatchingGroup(s.mpflipfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil,tp)
	if #sg>0 then
		Duel.ChangePosition(sg,POS_FACEUP_ATTACK,POS_FACEUP_ATTACK,POS_FACEUP_DEFENSE,POS_FACEUP_DEFENSE)
	end
end
s.activate=aux.MPEachOpponent(s.mpflip)

-- Keep the stock timer; the position information includes every opponent.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return e:IsHasType(EFFECT_TYPE_ACTIVATE) end
	local c=e:GetHandler()
	c:SetTurnCounter(0)
	local sg=Duel.GetMatchingGroup(s.mpflipfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil,tp)
	Duel.SetOperationInfo(0,CATEGORY_POSITION,sg,#sg,0,0)
	--destroy
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
	e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
	e1:SetCode(EVENT_PHASE+PHASE_END)
	e1:SetCountLimit(1)
	e1:SetRange(LOCATION_SZONE)
	e1:SetCondition(s.descon)
	e1:SetOperation(s.desop)
	e1:SetReset(RESETS_STANDARD_PHASE_END|RESET_OPPO_TURN,3)
	c:RegisterEffect(e1)
	local e3=Effect.CreateEffect(c)
	e3:SetType(EFFECT_TYPE_SINGLE)
	e3:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_IGNORE_IMMUNE+EFFECT_FLAG_SET_AVAILABLE)
	e3:SetCode(1082946)
	e3:SetLabelObject(e1)
	e3:SetOwnerPlayer(tp)
	e3:SetOperation(s.reset)
	e3:SetReset(RESETS_STANDARD_PHASE_END|RESET_OPPO_TURN,3)
	c:RegisterEffect(e3)
end
