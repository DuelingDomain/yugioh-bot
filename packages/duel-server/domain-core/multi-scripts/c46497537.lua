if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- Owner ruling 2026-10-23: any living opponent with equal LP enables the GY
-- effect. Setting this card uses no opponent amount, target or recipient.
local mp_initial=s.initial_effect
function s.initial_effect(c)
	local register=Card.RegisterEffect
	Card.RegisterEffect=function(card,e,...)
		if card==c and e:IsHasType(EFFECT_TYPE_IGNITION) then
			e:SetCondition(function(e,tp)
				local own=Duel.GetLP(tp)
				return aux.MPAnyOpponentLP(tp,function(lp) return lp==own end)
			end)
		end
		return register(card,e,...)
	end
	local ok,err=pcall(mp_initial,c)
	Card.RegisterEffect=register
	if not ok then error(err,0) end
end

local mp_settg=s.settg
function s.settg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return mp_settg(e,tp,eg,ep,ev,re,r,rp,chk) end
	local own=Duel.GetLP(tp)
	local seat=aux.MPSelectLPOpponent(tp,function(lp) return lp==own end)
	aux.MPLPOpponentHint(e:GetHandler(),seat)
	return mp_settg(e,tp,eg,ep,ev,re,r,rp,chk)
end
