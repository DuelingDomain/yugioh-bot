if not aux.MPAny then return end
-- Sangen Kaiho: the activation condition asks if any one opponent controls more monsters than you.
function s.phcon(e,tp,eg,ep,ev,re,r,rp)
	if not Duel.IsMainPhase() then return false end
	local g=Duel.GetFieldGroup(tp,LOCATION_MZONE,0)
	return #g>0 and g:FilterCount(s.phconfilter,nil)==#g
		and aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>#g end)()
end

-- The Graveyard effect counts all attacks this turn, with one read per team in Tag.
-- A folded GetFlagEffect(1,id) would mark the condition as needing an opponent pick.
function s.mp_attackcon()
	local total,seen=0,{}
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local key=aux.MPKeyOfSeat(seat_i)
		if not seen[key] then
			seen[key]=true
			total=total+Duel.GetFlagEffect(tp_i,id)
		end
	end)
	return total>=3
end
local mp_initial=s.initial_effect
function s.initial_effect(c)
	local register=Card.RegisterEffect
	Card.RegisterEffect=function(card,e,...)
		if card==c and e:GetCode()==EVENT_FREE_CHAIN and e:GetRange()==LOCATION_GRAVE then
			e:SetCondition(s.mp_attackcon)
		end
		return register(card,e,...)
	end
	local ok,err=pcall(mp_initial,c)
	Card.RegisterEffect=register
	if not ok then error(err,0) end
end
