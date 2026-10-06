if not aux.MPForEachDuelist then return end
-- The battle damage is avoided and every duelist takes 1000 damage (R1, Q3, Tag partner included).
function s.dmop(e,tp,eg,ep,ev,re,r,rp)
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetType(EFFECT_TYPE_FIELD)
	e1:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)
	e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	e1:SetTargetRange(1,0)
	e1:SetReset(RESET_PHASE|PHASE_DAMAGE)
	if Duel.MPMode()==2 then
		local team=aux.MPKey(tp)
		aux.MPForEachDuelist(function(tp_i,seat_i)
			if aux.MPKeyOfSeat(seat_i)==team then Duel.RegisterEffect(e1:Clone(),tp_i) end
		end)
	else
		Duel.RegisterEffect(e1,tp)
	end
	aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,1000,REASON_EFFECT,true) end)
	Duel.RDComplete()
end

-- Dynatag: either Tag partner may prevent the team's battle damage.
-- GetBattleDamage(tp) reads one seat, while the Tag team's LP is shared.
local stock_con=s.dmcon
function s.dmcon(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()~=2 then return stock_con(e,tp,eg,ep,ev,re,r,rp) end
	local team=aux.MPKey(tp)
	return aux.MPAnyDuelist(function(tp_i,seat_i)
		return aux.MPKeyOfSeat(seat_i)==team and stock_con(e,tp_i,eg,ep,ev,re,r,rp)
	end)
end
