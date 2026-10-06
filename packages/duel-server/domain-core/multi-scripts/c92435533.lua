if not Duel.MPAttackedSeat or not Duel.MPBindSeat or not Duel.MPSeatOf or not aux.MPForEachDuelist or not aux.MPAnyOpponent then return end
-- Lazion, the Timelord (script fix, #213): the stock effect shuffles the Graveyard of "1-tp" with no bound opponent, so at 3 or 4 seats the
-- controller could pick any living opponent, also one that Lazion never battled. Rulebook v1.4 (General Card Rulings): if you battled multiple
-- opponents (e.g. it attacked twice), you choose an opponent among the ones you battled to apply the effect; if you declare an attack with
-- Lazion at player A and an effect makes you battle your own monster, the effect still applies to player A. OD-LAZION: an opponent counts when
-- Lazion attacked them or they attacked Lazion; a battled opponent who left the duel gives no effect.
-- Record: a continuous effect marks the seat of each opponent that Lazion battled (a flag per seat, reset in the End Phase or when Lazion leaves
-- the field). The seat that an attack goes at is read when the attack is declared (Duel.MPAttackedSeat) and kept in a pending flag until the
-- battle happens, so a redirected attack still counts for the declared seat. A replayed attack (the target left) is a new choice and replaces it. The seat of the monster that Lazion actually battled counts too.
-- A direct attack is no battle (the stock condition needs a battled card) and records nothing. The choice is made at resolution among the living
-- recorded opponents (no activation pick: tdtg reads nothing of the opponent, it only sets a possible operation info on the opponent Graveyard); Duel.MPBindSeat binds the chosen seat for the Graveyard read.
-- Tag keeps the stock effect, also its target (the opposing team is one joined side).
local MP_PENDING=id+4
local MP_RESET=RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_END
local function mp_record(c,seat)
	if seat and seat>=0 and seat<=3 and c:GetFlagEffect(id+seat)==0 then
		c:RegisterFlagEffect(id+seat,MP_RESET,0,1)
	end
end
function s.mpdeclare(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	c:ResetFlagEffect(MP_PENDING)
	local seat=Duel.MPAttackedSeat()
	if seat then c:RegisterFlagEffect(MP_PENDING,MP_RESET,0,1,seat) end
end
-- A replayed attack raises no EVENT_ATTACK_ANNOUNCE (the core skips it), but every target choice raises EVENT_BE_BATTLE_TARGET with reason 0.
-- A replay is the attacker's own new choice, so the pending seat follows it. Duel.ChangeAttackTarget (a redirect by an effect, for example Attack
-- Guidance Armor) raises the event with REASON_REPLACE and keeps the declared seat.
function s.mpretarget(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if Duel.GetAttacker()~=c or (r&REASON_REPLACE)~=0 then return end
	c:ResetFlagEffect(MP_PENDING)
	local seat=Duel.MPAttackedSeat()
	if seat then c:RegisterFlagEffect(MP_PENDING,MP_RESET,0,1,seat) end
end
function s.mpbattled(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if Duel.GetAttacker()==c then
		local target=Duel.GetAttackTarget()
		if not target then return end
		if c:GetFlagEffect(MP_PENDING)>0 then mp_record(c,c:GetFlagEffectLabel(MP_PENDING)) end
		mp_record(c,Duel.MPSeatOf(target))
	elseif Duel.GetAttackTarget()==c then
		local attacker=Duel.GetAttacker()
		if attacker then mp_record(c,Duel.MPSeatOf(attacker)) end
	end
end
local mp_initial_effect=s.initial_effect
function s.initial_effect(c)
	mp_initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)
	e1:SetCode(EVENT_ATTACK_ANNOUNCE)
	e1:SetRange(LOCATION_MZONE)
	e1:SetOperation(s.mpdeclare)
	c:RegisterEffect(e1)
	local e2=Effect.CreateEffect(c)
	e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)
	e2:SetCode(EVENT_BATTLED)
	e2:SetRange(LOCATION_MZONE)
	e2:SetOperation(s.mpbattled)
	c:RegisterEffect(e2)
	local e3=Effect.CreateEffect(c)
	e3:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
	e3:SetCode(EVENT_BE_BATTLE_TARGET)
	e3:SetRange(LOCATION_MZONE)
	e3:SetOperation(s.mpretarget)
	c:RegisterEffect(e3)
end
-- The living opponents of the controller that Lazion battled this turn, in seat order.
local function mp_battled_seats(c,tp)
	local me=aux.MPKey(tp)
	local seats={}
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if aux.MPKeyOfSeat(seat_i)~=me and c:GetFlagEffect(id+seat_i)>0 then seats[#seats+1]=seat_i end
	end)
	table.sort(seats)
	return seats
end
local mp_tdcon,mp_tdtg,mp_tdop=s.tdcon,s.tdtg,s.tdop
function s.tdcon(e,tp,eg,ep,ev,re,r,rp)
	if not mp_tdcon(e,tp,eg,ep,ev,re,r,rp) then return false end
	if Duel.MPMode()~=1 then return true end
	local c=e:GetHandler()
	return aux.MPAnyOpponent(tp,function(tp_i,seat_i) return c:GetFlagEffect(id+seat_i)>0 end)
end
function s.tdtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if Duel.MPMode()~=1 then return mp_tdtg(e,tp,eg,ep,ev,re,r,rp,chk) end
	if chk==0 then return true end
	-- The operation info keeps the opponent Graveyard visible to responses (Ghost Belle & Haunted Mansion reads it) without "1-tp" (an unbound
	-- "1-tp" asks the controller for an opponent at activation, PLAYER_ALL asks nothing). Tag calls the stock target.
	Duel.SetPossibleOperationInfo(0,CATEGORY_TODECK,nil,0,PLAYER_ALL,LOCATION_GRAVE)
end
function s.tdop(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()==1 then
		local seats=mp_battled_seats(e:GetHandler(),tp)
		if #seats==0 then return end
		local seat=seats[1]
		if #seats>1 then
			local options={}
			for i,opponent in ipairs(seats) do options[i]=0xfffe0000+opponent end
			seat=seats[Duel.SelectOption(tp,table.unpack(options))+1]
		end
		if not seat or not Duel.MPBindSeat(seat) then return end
		local g=Duel.GetMatchingGroup(Card.IsAbleToDeck,tp,0,LOCATION_GRAVE,nil)
		if #g>0 then
			Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)
		end
		return
	end
	return mp_tdop(e,tp,eg,ep,ev,re,r,rp)
end
