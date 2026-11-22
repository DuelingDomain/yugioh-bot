-- Mist Valley Apex Avian: shared Standard/Domain, 1v1/multiplayer bug fix.
-- Upstream: ProjectIgnis/CardScripts official/c29587993.lua at
-- 37f270dc813a (historical baseline). The stock condition is
-- function(e) but reads the global ev, which is nil, so
-- Duel.IsChainNegatable(ev) raised an error and the effect was never offered.
-- The condition must take the chain link number as its fifth parameter.
function s.initial_effect(c)
	--Negate the activation of a card or effect
	local e1=Effect.CreateEffect(c)
	e1:SetDescription(aux.Stringid(id,0))
	e1:SetCategory(CATEGORY_TOHAND+CATEGORY_NEGATE+CATEGORY_DESTROY)
	e1:SetType(EFFECT_TYPE_QUICK_O)
	e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)
	e1:SetCode(EVENT_CHAINING)
	e1:SetRange(LOCATION_MZONE)
	e1:SetCountLimit(1,0,EFFECT_COUNT_CODE_CHAIN)
	e1:SetCondition(function(e,tp,eg,ep,ev) return not e:GetHandler():IsStatus(STATUS_BATTLE_DESTROYED) and Duel.IsChainNegatable(ev) end)
	e1:SetTarget(s.negtg)
	e1:SetOperation(s.negop)
	c:RegisterEffect(e1)
end
