if not aux.MPAny then return end
-- Appointer of the Red Lotus: save the declared seat at activation in FFA.
-- Return the card during that seat's next End Phase (R-FFA-DECLARED-DURATION).
-- If that seat leaves, the next living opponent's End Phase counts (R3).
-- Keep the stock timing in 1v1 and Tag, and the existing return to the owner's hand.
local stock_target=s.target
local stock_activate=s.activate
local stock_retcon=s.retcon

-- Older proof cores have the seat iterator but do not have MPTurnSeat.
local function mp_turn_is(seat)
	if Duel.MPTurnSeat then return Duel.MPTurnSeat()==seat end
	local i=1
	while true do
		local ok,current=Duel.MPNthDuelist(i)
		if not ok then break end
		if current==seat then
			local result=Duel.IsTurnPlayer(0)
			Duel.MPNthDuelist(0)
			return result
		end
		i=i+1
	end
	Duel.MPNthDuelist(0)
	return false
end

local function mp_alive(seat)
	if Duel.MPIsAlive then return Duel.MPIsAlive(seat) end
	local i=1
	while true do
		local ok,current=Duel.MPNthDuelist(i)
		if not ok then break end
		if current==seat then
			Duel.MPNthDuelist(0)
			return true
		end
		i=i+1
	end
	Duel.MPNthDuelist(0)
	return false
end

function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	local result=stock_target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk~=0 and Duel.MPMode()==1 then
		e:SetLabel(Duel.MPSeat(1-tp))
	end
	return result
end

function s.activate(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()~=1 then return stock_activate(e,tp,eg,ep,ev,re,r,rp) end
	local op=e:GetLabel()
	if not Duel.MPBindSeat(op) then return end
	local g0=Duel.GetFieldGroup(tp,0,LOCATION_HAND)
	Duel.ConfirmCards(tp,g0)
	local g=Duel.GetMatchingGroup(Card.IsAbleToRemove,tp,0,LOCATION_HAND,nil)
	if #g>0 then
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_REMOVE)
		local sg=g:Select(tp,1,1,nil)
		local tc=sg:GetFirst()
		Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)
		tc:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD,0,1)
		local e1=Effect.CreateEffect(e:GetHandler())
		e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
		e1:SetCode(EVENT_PHASE+PHASE_END)
		e1:SetCountLimit(1)
		if mp_turn_is(op) and Duel.IsPhase(PHASE_END) then
			e1:SetLabel(Duel.GetTurnCount())
			e1:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN,2)
		else
			e1:SetLabel(0)
			e1:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN)
		end
		e1:SetValue(op)
		e1:SetLabelObject(tc)
		e1:SetCondition(s.retcon)
		e1:SetOperation(s.retop)
		Duel.RegisterEffect(e1,tp)
	end
	Duel.ShuffleHand(1-tp)
end

function s.retcon(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()~=1 then return stock_retcon(e,tp,eg,ep,ev,re,r,rp) end
	local tc=e:GetLabelObject()
	if tc:GetFlagEffect(id)==0 then
		e:Reset()
		return false
	end
	local op=e:GetValue()
	local alive=mp_alive(op)
	local counted=alive and mp_turn_is(op) or not alive and Duel.IsTurnPlayer(1-tp)
	return counted and Duel.GetTurnCount()~=e:GetLabel()
end

function s.retop(e,tp,eg,ep,ev,re,r,rp)
	local tc=e:GetLabelObject()
	Duel.SendtoHand(tc,nil,REASON_EFFECT)
end
