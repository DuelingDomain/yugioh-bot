if not aux.MPForEachController or not Duel.MPTurnOwns then return end
-- Only the owning duelist's Standby Phase applies; the target fixes the damage recipient.
function s.initial_effect(c)
	aux.AddEquipProcedure(c)
	--The equipped monster cannot attack
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_EQUIP)
	e1:SetCode(EFFECT_CANNOT_ATTACK)
	c:RegisterEffect(e1)
	--Inflict 500 damage to the controller of the equipped monster
	local e2=Effect.CreateEffect(c)
	e2:SetDescription(aux.Stringid(id,0))
	e2:SetCategory(CATEGORY_DAMAGE)
	e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)
	e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	e2:SetCode(EVENT_PHASE+PHASE_STANDBY)
	e2:SetRange(LOCATION_SZONE)
	e2:SetCountLimit(1)
	e2:SetCondition(s.damcon)
	e2:SetTarget(s.damtg)
	e2:SetOperation(s.damop)
	c:RegisterEffect(e2)
end
function s.damcon(e,tp,eg,ep,ev,re,r,rp)
	return e:GetHandler():GetEquipTarget() and Duel.MPTurnOwns(e:GetHandler())
end
local mp_damtg=s.damtg
function s.damtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return mp_damtg(e,tp,eg,ep,ev,re,r,rp,chk) end
	local tc=e:GetHandler():GetEquipTarget()
	if not tc then return end
	aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
		mp_damtg(e,tp,eg,ep,ev,re,r,rp,chk)
	end)
end
local mp_damop=s.damop
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local tc=e:GetHandler():GetEquipTarget()
	if not tc then return end
	aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
		mp_damop(e,tp,eg,ep,ev,re,r,rp)
	end)
end
