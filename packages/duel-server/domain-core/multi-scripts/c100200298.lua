if not Duel.MPSeatOf then return end
-- Owner 2026-10-18: compare the actual attacker and end that duelist's Battle Phase.
-- This free-chain effect has no event opponent during its first legality check.
function s.efftg(e,tp,eg,ep,ev,re,r,rp,chk)
	local attacker=Duel.GetAttacker()
	local option_1=Duel.CheckEvent(EVENT_ATTACK_ANNOUNCE) and attacker and attacker:IsControler(1-tp)
	if option_1 then
		local own=Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)
		local opposing=0
		if Duel.MPMode()==1 then
			local seat=Duel.MPSeatOf(attacker)
			opposing=Duel.GetFieldGroup(tp,LOCATION_MZONE,LOCATION_MZONE):FilterCount(function(c)
				return Duel.MPSeatOf(c)==seat
			end,nil)
		else
			opposing=Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)
		end
		option_1=opposing>own
	end
	local event_check,_,event_player,event_value,event_reff=Duel.CheckEvent(EVENT_CHAINING,true)
	local option_2=event_check and event_player==1-tp and event_reff:IsMonsterEffect() and Chain.IsDisablable(event_value)
	if chk==0 then return option_1 or option_2 end
	local choice=Duel.SelectEffect(tp,{option_1,aux.Stringid(id,2)},{option_2,aux.Stringid(id,3)})
	local data=e:GetChainData()
	data.choice=choice
	if choice==1 then
		e:SetCategory(0)
		data.attacker_seat=Duel.MPSeatOf(attacker)
	elseif choice==2 then
		e:SetCategory(CATEGORY_DISABLE+CATEGORY_DESTROY)
		local card=event_reff:GetHandler()
		data.event_value=event_value
		data.event_rcard=card
		data.event_reff=event_reff
		Duel.SetOperationInfo(0,CATEGORY_DISABLE,card,1,tp,0)
		if card:IsDestructable() and card:IsRelateToEffect(event_reff) then Duel.SetOperationInfo(0,CATEGORY_DESTROY,card,1,tp,0) end
	end
end
local mp_operation=s.effop
function s.effop(e,tp,eg,ep,ev,re,r,rp)
	local data=e:GetChainData()
	if data.choice~=1 then return mp_operation(e,tp,eg,ep,ev,re,r,rp) end
	if not Duel.NegateAttack() then return end
	local old=Duel.MPSeatBinding()
	if Duel.MPBindSeat(data.attacker_seat) then
		Duel.SkipPhase(1-tp,PHASE_BATTLE,RESET_PHASE|PHASE_BATTLE_STEP,1)
	end
	if old==255 then Duel.MPBindSeat() else Duel.MPBindSeat(old) end
end
-- A Tag partner's normal draw is not the controller's draw.
local mp_draw_condition=s.spcon
function s.spcon(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()==2 and Duel.MPTurnSeat()~=Duel.MPSeatOf(e:GetHandler()) then return false end
	return mp_draw_condition(e,tp,eg,ep,ev,re,r,rp)
end
