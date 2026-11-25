if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Shatranga limits each FFA opponent separately. The chain link names the
-- real activator, while the activation check receives a folded player value.
local function count_activation(e,tp,eg,ep,ev,re)
	if not re:IsMonsterEffect() then return end
	local c=e:GetHandler()
	local seat=Duel.MPChainSeat(ev)
	if seat>=0 and seat~=Duel.MPSeatOf(c) then
		c:RegisterFlagEffect(id+seat,RESET_EVENT|RESETS_STANDARD_DISABLE|RESET_CONTROL|RESET_PHASE|PHASE_END,0,1)
	end
end

local function activation_limit(e,re,tp)
	return re:IsMonsterEffect() and e:GetHandler():HasFlagEffect(id+aux.MPKey(tp),5)
end

local initial=s.initial_effect
function s.initial_effect(c)
	local register=Card.RegisterEffect
	Card.RegisterEffect=function(card,eff,...)
		if card==c then
			local code=eff:GetCode()
			if code==EVENT_CHAINING then
				eff:SetOperation(count_activation)
			elseif code==EFFECT_CANNOT_ACTIVATE then
				eff:SetCondition(function(e) return e:GetHandler():IsContinuousSpell() end)
				eff:SetValue(activation_limit)
			end
		end
		return register(card,eff,...)
	end
	local ok,err=pcall(initial,c)
	Card.RegisterEffect=register
	if not ok then error(err,0) end
end
