-- The incoming effect is the exact, non-binding origin for the immunity column.
if not aux.MPGeometryShared then return end
local mp_initial=s.initial_effect
function s.initial_effect(c)
	local register=Card.RegisterEffect
	Card.RegisterEffect=function(card,e,...)
		if card==c and e:GetCode()==EFFECT_IMMUNE_EFFECT then
			local value=e:GetValue()
			e:SetValue(function(ie,te)
				if not aux.MPGeometryShared() then return value(ie,te) end
				return te:GetOwnerPlayer()~=ie:GetHandlerPlayer() and te:IsActivated()
					and ie:GetHandler():IsColumn(te:GetCardSequence(),te:GetCardControler(),te:GetCardLocation(),te)
			end)
		end
		return register(card,e,...)
	end
	mp_initial(c)
	Card.RegisterEffect=register
end
