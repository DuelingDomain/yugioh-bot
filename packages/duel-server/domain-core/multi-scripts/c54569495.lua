-- Marincess Crown Tail: damage protection applies to both Tag partners (R-TAG-TEAM-DAMAGE).
if not aux.MPForEachDuelist then return end
local stock_spop=s.spop
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()~=2 then return stock_spop(e,tp,eg,ep,ev,re,r,rp) end
	local c=e:GetHandler()
	-- Summon once, to the holder's field, before registering protection for each partner.
	if c:IsRelateToEffect(e) and Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)~=0 then
		local team=aux.MPKey(tp)
		aux.MPForEachDuelist(function(tp_i,seat_i)
			if aux.MPKeyOfSeat(seat_i)~=team then return end
			local e1=Effect.CreateEffect(c)
			e1:SetType(EFFECT_TYPE_FIELD)
			e1:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)
			e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
			e1:SetTargetRange(1,0)
			e1:SetValue(HALF_DAMAGE)
			e1:SetReset(RESET_PHASE|PHASE_DAMAGE)
			Duel.RegisterEffect(e1,tp_i)
		end)
	end
end

local stock_damop1=s.damop1
function s.damop1(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()~=2 then return stock_damop1(e,tp,eg,ep,ev,re,r,rp) end
	local team=aux.MPKey(tp)
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if aux.MPKeyOfSeat(seat_i)==team then stock_damop1(e,tp_i,eg,ep,ev,re,r,rp) end
	end)
end

local stock_damcon3=s.damcon3
function s.damcon3(e)
	if Duel.MPMode()~=2 then return stock_damcon3(e) end
	local tp=e:GetHandlerPlayer()
	local team=aux.MPKey(tp)
	local g=Duel.GetMatchingGroup(s.damfilter,tp,LOCATION_GRAVE,0,nil)
	local threshold=g:GetSum(Card.GetLink)*1000
	-- The untouched partner has zero damage. It must not make an over-limit battle pass.
	return not aux.MPAnyDuelist(function(tp_i,seat_i)
		return aux.MPKeyOfSeat(seat_i)==team and Duel.GetBattleDamage(tp_i)>threshold
	end)
end
