if not aux.MPKey then return end
-- Confusion Chaff: the global check counts the direct attacks that each player faced this turn (stock: s[1-controller of the attacker]) and
-- keeps the first attacker in s[2]. At more than two seats "1-controller" is not the attacked duelist and s[2] is a seat slot. The count is
-- kept per key of the ATTACKED duelist (FFA the seat, Tag the team: aux.MPKey; the attacked seat of a direct attack is the seat whose
-- Duel.GetBattleMonster gives the attacker as the other side) in s.mpcount, the first attacker per key in s.mpfirst. The holder reads its own key.
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
		tc:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1,k)
		if s.mpcount[k]==1 then
			s.mpfirst[k]=tc
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
	local k=aux.MPKey(tp)
	local first=s.mpfirst[k]
	return Duel.IsTurnPlayer(1-tp) and Duel.GetAttackTarget()==nil and s.mpcount[k]==2
		and first~=nil and first:GetFlagEffect(id)~=0 and Duel.GetAttacker()~=first
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local a=Duel.GetAttacker()
	local d=s.mpfirst[aux.MPKey(tp)]
	if d and a:GetFlagEffect(id)~=0 and d:GetFlagEffect(id)~=0
		and a:CanAttack() and not a:IsImmuneToEffect(e) and not d:IsImmuneToEffect(e) then
		Duel.CalculateDamage(a,d)
	end
end
