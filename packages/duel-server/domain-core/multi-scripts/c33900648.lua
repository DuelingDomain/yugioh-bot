if not aux.MPKey then return end
-- Clear World: the stock EARTH, WATER and FIRE effects are global and are registered only for seats 0 and 1.
-- Add seats 2 and 3. These callbacks see real seats, so Clear Wall checks and opponent hints use real seats too.
local mp_global_player
local function mp_global(fn)
	return function(e,tp,...)
		local previous=mp_global_player
		mp_global_player=tp
		local result=table.pack(pcall(fn,e,tp,...))
		mp_global_player=previous
		if not result[1] then error(result[2],0) end
		return table.unpack(result,2,result.n)
	end
end
local mp_attribute=s.PlayerControlsAttributeOrIsAffectedByClearWall
function s.PlayerControlsAttributeOrIsAffectedByClearWall(player,attribute)
	if mp_global_player==nil then return mp_attribute(player,attribute) end
	local own=aux.MPKeyOfSeat(player)
	for seat=0,3 do
		local lp=Duel.GetLP(seat)
		if lp and lp>0 and aux.MPKeyOfSeat(seat)~=own
			and Duel.IsPlayerAffectedByEffect(seat,EFFECT_CLEAR_WALL) then return true end
	end
	return Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsAttribute,attribute),player,LOCATION_MZONE,0,1,nil)
end
local function mp_hint(e,tp)
	Duel.Hint(HINT_CARD,0,id)
	local own=aux.MPKeyOfSeat(tp)
	for seat=0,3 do
		local lp=Duel.GetLP(seat)
		if lp and lp>0 and aux.MPKeyOfSeat(seat)~=own then
			Duel.Hint(HINT_OPSELECTED,seat,e:GetDescription())
		end
	end
end
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	e:GetHandler():RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)
	if not s.PlayerIsAffectedByClearWorld(tp,ATTRIBUTE_EARTH)
		or not Duel.IsExistingMatchingCard(Card.IsPosition,tp,LOCATION_MZONE,0,1,nil,POS_FACEUP_DEFENSE) then return end
	mp_hint(e,tp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
	local g=Duel.SelectMatchingCard(tp,Card.IsPosition,tp,LOCATION_MZONE,0,1,1,nil,POS_FACEUP_DEFENSE)
	if #g==0 then return end
	Duel.HintSelection(g)
	Duel.Destroy(g,REASON_EFFECT)
end
function s.discardop(e,tp,eg,ep,ev,re,r,rp)
	e:GetHandler():RegisterFlagEffect(id+1,RESETS_STANDARD_PHASE_END,0,1)
	if not s.PlayerIsAffectedByClearWorld(tp,ATTRIBUTE_WATER)
		or Duel.GetFieldGroupCount(tp,LOCATION_HAND,0)==0 then return end
	mp_hint(e,tp)
	Duel.DiscardHand(tp,nil,1,1,REASON_EFFECT|REASON_DISCARD)
end
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	e:GetHandler():RegisterFlagEffect(id+2,RESETS_STANDARD_PHASE_END,0,1)
	if not s.PlayerIsAffectedByClearWorld(tp,ATTRIBUTE_FIRE) then return end
	mp_hint(e,tp)
	Duel.Damage(tp,1000,REASON_EFFECT)
end
local mp_ops={[s.desop]=true,[s.discardop]=true,[s.damop]=true}
local mp_wrapped={}
local mp_initial=s.initial_effect
function s.initial_effect(c)
	local card_register=Card.RegisterEffect
	Card.RegisterEffect=function(card,e,...)
		if card==c and e:GetOperation()==s.maintop then
			e:SetCondition(function(e) return Duel.MPTurnControls(e:GetHandler()) end)
		end
		return card_register(card,e,...)
	end
	local reg=Duel.RegisterEffect
	Duel.RegisterEffect=function(e,p,...)
		local op=e:GetOperation()
		if not mp_ops[op] then return reg(e,p,...) end
		if not mp_wrapped[op] then
			local wrapped=mp_global(op)
			mp_ops[wrapped]=true
			mp_wrapped[wrapped]=true
			e:SetOperation(wrapped)
			e:SetCondition(mp_global(e:GetCondition()))
		end
		local result=reg(e,p,...)
		if p==1 then
			for seat=2,3 do
				local lp=Duel.GetLP(seat)
				if lp and lp>0 then reg(e:Clone(),seat) end
			end
		end
		return result
	end
	local ok,err=pcall(mp_initial,c)
	Duel.RegisterEffect=reg
	Card.RegisterEffect=card_register
	if not ok then error(err,0) end
end
