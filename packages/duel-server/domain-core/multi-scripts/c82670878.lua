if not aux.MPKey then return end
-- Ogre of the Scarlet Sorrow: the global check counts the direct attacks that each player faced this turn (stock: s[1-controller of the
-- attacker]) and keeps the first attacker in s[2]. At more than two seats "1-controller" is not the attacked duelist (it is -1 or a wrong
-- seat for the controllers 2 and 3) and s[2] is the key of seat 2. The global check sees the real seats, so the count is kept per key
-- of the ATTACKED duelist (FFA the seat, Tag the team: aux.MPKey; the attacked seat of a direct attack is the one that Duel.GetBattleMonster
-- gives the attacker as the other side) in s.mpcount, and the first attacker per key in s.mpfirst. The holder reads its own key.
s.mpcount={[0]=0,[1]=0,[2]=0,[3]=0}
s.mpfirst={}
local function mp_defender_key(tc)
	for seat=0,3 do
		local own,other=Duel.GetBattleMonster(seat)
		if own==nil and other==tc then return aux.MPKey(seat) end
	end
	return nil
end
local mp_ie=s.initial_effect
function s.initial_effect(c)
	mp_ie(c)
	if not s.mp_seats then
		s.mp_seats=true
		aux.AddValuesReset(function()
			s.mpcount={[0]=0,[1]=0,[2]=0,[3]=0}
			s.mpfirst={}
		end)
	end
end
function s.check(e,tp,eg,ep,ev,re,r,rp)
	local tc=eg:GetFirst()
	if Duel.GetAttackTarget()==nil then
		local k=mp_defender_key(tc)
		if not k then return end
		s.mpcount[k]=s.mpcount[k]+1
		if s.mpcount[k]==1 then
			s.mpfirst[k]=tc
			tc:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1,k)
		elseif s.mpcount[k]==2 then
			Duel.RaiseEvent(tc,EVENT_CUSTOM+id,e,0,0,0,0)
		end
	end
end
function s.check2(e,tp,eg,ep,ev,re,r,rp)
	local tc=eg:GetFirst()
	if tc:GetFlagEffect(id)~=0 and Duel.GetAttackTarget()~=nil then
		local k=tc:GetFlagEffectLabel(id)
		s.mpcount[k]=s.mpcount[k]-1
	end
end
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return Duel.IsTurnPlayer(1-tp) and Duel.GetAttackTarget()==nil and s.mpcount[aux.MPKey(0)]==2
end
function s.adop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	local tc=s.mpfirst[aux.MPKey(0)]
	if c:IsFaceup() and c:IsRelateToEffect(e) then
		if tc and tc:GetFlagEffect(id) then
			local e1=Effect.CreateEffect(c)
			e1:SetType(EFFECT_TYPE_SINGLE)
			e1:SetCode(EFFECT_SET_ATTACK_FINAL)
			e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)
			e1:SetValue(tc:GetAttack())
			c:RegisterEffect(e1)
			local e2=e1:Clone()
			e2:SetCode(EFFECT_SET_DEFENSE_FINAL)
			e2:SetValue(tc:GetDefense())
			c:RegisterEffect(e2)
		end
		--at limit
		local e3=Effect.CreateEffect(c)
		e3:SetType(EFFECT_TYPE_FIELD)
		e3:SetCode(EFFECT_CANNOT_SELECT_BATTLE_TARGET)
		e3:SetRange(LOCATION_MZONE)
		e3:SetTargetRange(0,LOCATION_MZONE)
		e3:SetValue(s.atlimit)
		e3:SetReset(RESETS_STANDARD_PHASE_END)
		c:RegisterEffect(e3)
	end
end
