if not aux.MPKey then return end
-- Black Garden: the check (global, real seats) raises the custom event with a bit mask of the players whose monsters were summoned, bit 0
-- for the player 0 and bit 1 for the player 1; the handlers read it with bit.extract(ev,tp) and bit.extract(ev,1-tp). The mask is made with
-- the key of every real seat (aux.MPKey: FFA the seat, Tag the team), and the handlers ask for the own key and for any other key.
local function mp_own(ev) return (ev&(1<<aux.MPKey(0)))~=0 end
local function mp_other(ev) return (ev&~(1<<aux.MPKey(0)))~=0 end
function s.regcon(e,tp,eg,ep,ev,re,r,rp)
	local sf=0
	for seat=0,3 do
		if eg:IsExists(s.cfilter,1,nil,seat) then
			sf=sf|(1<<aux.MPKey(seat))
		end
	end
	e:SetLabel(sf)
	return sf~=0
end
function s.atksptg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return e:GetHandler():IsRelateToEffect(e) end
	Duel.SetTargetCard(eg)
	Duel.SetOperationInfo(0,CATEGORY_TOKEN,nil,1,0,0)
	local p
	if mp_own(ev) and mp_other(ev) then
		p=PLAYER_ALL
	elseif mp_own(ev) then
		p=tp
	else
		p=1-tp
	end
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,p,0)
end
function s.atkspop(e,tp,eg,ep,ev,re,r,rp)
	local g=eg:Filter(s.atkfilter,nil,e)
	if #g==0 then return end
	local change=false
	for tc in g:Iter() do
		local preatk=tc:GetAttack()
		local e1=Effect.CreateEffect(e:GetHandler())
		e1:SetType(EFFECT_TYPE_SINGLE)
		e1:SetCode(EFFECT_SET_ATTACK_FINAL)
		e1:SetValue(math.ceil(tc:GetAttack()/2))
		e1:SetReset(RESET_EVENT|RESETS_STANDARD)
		tc:RegisterEffect(e1)
		if not tc:IsImmuneToEffect(e1) and math.ceil(preatk/2)==tc:GetAttack() then
			change=true
		end
	end
	if not change then return end
	if mp_own(ev) and Duel.GetLocationCount(1-tp,LOCATION_MZONE)>0
		and Duel.IsPlayerCanSpecialSummonMonster(tp,TOKEN_ROSE,SET_ROSE,TYPES_TOKEN,800,800,2,RACE_PLANT,ATTRIBUTE_DARK,POS_FACEUP_ATTACK,1-tp) then
		local token=Duel.CreateToken(tp,TOKEN_ROSE)
		Duel.SpecialSummonStep(token,SUMMONED_BY_BLACK_GARDEN,tp,1-tp,false,false,POS_FACEUP_ATTACK)
	end
	if mp_other(ev) and Duel.GetLocationCount(tp,LOCATION_MZONE)>0
		and Duel.IsPlayerCanSpecialSummonMonster(1-tp,TOKEN_ROSE,SET_ROSE,TYPES_TOKEN,800,800,2,RACE_PLANT,ATTRIBUTE_DARK,POS_FACEUP_ATTACK,tp) then
		local token=Duel.CreateToken(1-tp,TOKEN_ROSE)
		Duel.SpecialSummonStep(token,SUMMONED_BY_BLACK_GARDEN,1-tp,tp,false,false,POS_FACEUP_ATTACK)
	end
	Duel.SpecialSummonComplete()
end
