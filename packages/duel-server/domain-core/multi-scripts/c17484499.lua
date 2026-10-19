if not aux.MPForEachDuelist then return end
-- Owner 2026-10-18: Each player swaps its own Deck and GY, starting with the turn player.
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetDescription(aux.Stringid(id,0))
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_DUEL)
	e1:SetCondition(function(e,tp)
		return aux.MPAllDuelists(function(p) return Duel.GetFieldGroupCount(p,LOCATION_GRAVE,0)>=15 end)
	end)
	e1:SetCost(Cost.PayLP(1000))
	e1:SetOperation(function(e,tp)
		aux.MPForEachDuelistFromTurn(function(p) Duel.SwapDeckAndGrave(p) end)
	end)
	e1:SetHintTiming(0,TIMING_DRAW_PHASE|TIMING_STANDBY_PHASE|TIMING_MAIN_END|TIMING_BATTLE_START|TIMING_BATTLE_END|TIMINGS_CHECK_MONSTER_E|TIMING_CHAIN_END)
	c:RegisterEffect(e1)
end
