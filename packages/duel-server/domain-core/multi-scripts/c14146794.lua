if not aux.MPForEachDuelist then return end
if Duel.MPMode()==1 then
	-- A living link keeps resolving after its source link is removed. Preserve independent actions.
	function s.damop(e,tp,eg,ep,ev,re,r,rp)
		local cid=Duel.GetChainInfo(ev,CHAININFO_CHAIN_ID)
		if not cid then return end
		local e2=Effect.CreateEffect(e:GetHandler())
		e2:SetType(EFFECT_TYPE_FIELD)
		e2:SetCode(EFFECT_CHANGE_DAMAGE)
		e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
		e2:SetTargetRange(0,1)
		e2:SetLabel(cid)
		e2:SetValue(s.damval)
		e2:SetReset(RESET_CHAIN)
		Duel.RegisterEffect(e2,tp)
	end
end

-- Donyoribo @Ignister: either Tag partner may prevent the team's battle damage.
-- GetBattleDamage(tp) reads one seat, while the Tag team's LP is shared.
local stock_con=s.condition
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()~=2 then return stock_con(e,tp,eg,ep,ev,re,r,rp) end
	local team=aux.MPKey(tp)
	return aux.MPAnyDuelist(function(tp_i,seat_i)
		return aux.MPKeyOfSeat(seat_i)==team and stock_con(e,tp_i,eg,ep,ev,re,r,rp)
	end)
end

-- Player-target effects also attach to one seat. Protect both seats of the team.
local stock_op=s.operation
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()~=2 then return stock_op(e,tp,eg,ep,ev,re,r,rp) end
	local team=aux.MPKey(tp)
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if aux.MPKeyOfSeat(seat_i)==team then stock_op(e,tp_i,eg,ep,ev,re,r,rp) end
	end)
end
