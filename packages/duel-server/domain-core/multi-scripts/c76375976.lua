--@replace
-- Mystic Mine: the continuous conditions ask about any one opponent; self-destruction requires every living opponent to be equal.
-- The lock of the opponents is PER OPPONENT: only an opponent that ALONE controls more monsters than you cannot activate monster
-- effects and cannot declare an attack (FFA). A seat that controls fewer or as many monsters is free. Two seats and Tag (one joined
-- opposing side) keep the stock lock. The original text follows, only the conditions, the lock of the opponents and the Destroy target changed.
local MPAny=aux.MPAny or function(f) return f end
--魔鐘洞
--Mystic Mine
--Scripted by Eerie Code
local s,id=GetID()
function s.initial_effect(c)
	--Activate
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	c:RegisterEffect(e1)
	--Cannot activate effects
	local e2=Effect.CreateEffect(c)
	e2:SetDescription(aux.Stringid(id,0))
	e2:SetType(EFFECT_TYPE_FIELD)
	e2:SetCode(EFFECT_CANNOT_ACTIVATE)
	e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
	e2:SetRange(LOCATION_FZONE)
	e2:SetTargetRange(1,0)
	e2:SetCondition(s.conself)
	e2:SetValue(s.aclimit)
	c:RegisterEffect(e2)
	local e3=e2:Clone()
	e3:SetTargetRange(0,1)
	e3:SetCondition(s.conopp)
	e3:SetValue(s.aclimitopp)
	c:RegisterEffect(e3)
	--Cannot declare attack
	local e4=Effect.CreateEffect(c)
	e4:SetType(EFFECT_TYPE_FIELD)
	e4:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)
	e4:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	e4:SetRange(LOCATION_FZONE)
	e4:SetTargetRange(1,0)
	e4:SetCondition(s.conself)
	c:RegisterEffect(e4)
	local e5=Effect.CreateEffect(c)
	e5:SetType(EFFECT_TYPE_FIELD)
	e5:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)
	e5:SetRange(LOCATION_FZONE)
	e5:SetTargetRange(0,LOCATION_MZONE)
	e5:SetCondition(s.conopp)
	e5:SetTarget(s.atktg)
	c:RegisterEffect(e5)
	--Destroy itself
	local e6=Effect.CreateEffect(c)
	e6:SetCategory(CATEGORY_DESTROY)
	e6:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)
	e6:SetCode(EVENT_PHASE+PHASE_END)
	e6:SetRange(LOCATION_FZONE)
	e6:SetCountLimit(1)
	e6:SetCondition(s.descon)
	e6:SetTarget(s.destg)
	e6:SetOperation(s.desop)
	c:RegisterEffect(e6)
end
function s.conself(e)
	local tp=e:GetHandlerPlayer()
	return MPAny(function() return Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)>Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end)()
end
function s.conopp(e)
	local tp=e:GetHandlerPlayer()
	return MPAny(function() return Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)<Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end)()
end
-- True when the card c belongs to an opponent that alone controls more monsters than tp. FFA only: the window i of the opponents shows the cards
-- of one opponent, so c is found in the window of the seat that holds it, and that window decides. Two seats and Tag: true (conopp has decided).
function s.opponent_over(tp,c)
	if not (Duel.MPMode and Duel.MPMode()==1) then return true end
	for i=1,Duel.MPOppCount() do
		Duel.MPWindow(i)
		local hit=Duel.GetFieldGroup(tp,0,LOCATION_ALL):IsContains(c)
			and Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)<Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)
		Duel.MPWindowEnd()
		if hit then return true end
	end
	return false
end
function s.aclimit(e,re,tp)
	return re:IsMonsterEffect()
end
function s.aclimitopp(e,re,tp)
	return re:IsMonsterEffect() and s.opponent_over(e:GetHandlerPlayer(),re:GetHandler())
end
function s.atktg(e,c)
	return s.opponent_over(e:GetHandlerPlayer(),c)
end
function s.descon(e,tp,eg,ep,ev,re,r,rp)
	-- FFA compares every living opponent, irrespective of a chain/event binding. Tag keeps the joined-team count.
	if not Duel.MPMode or Duel.MPMode()~=1 then
		return Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)==Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)
	end
	for i=1,Duel.MPOppCount() do
		Duel.MPWindow(i)
		local equal=Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)==Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)
		Duel.MPWindowEnd()
		if not equal then return false end
	end
	return true
end
function s.destg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return s.descon(e,tp,eg,ep,ev,re,r,rp) end
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,0,0)
end
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if c:IsRelateToEffect(e) then
		Duel.Destroy(c,REASON_EFFECT)
	end
end
