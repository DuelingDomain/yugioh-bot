if not aux.MPForEachDuelist then return end
-- Seventh Barian's: each living duelist takes damage for the Xyz Monsters on ALL fields (Q3).
-- Its Extra Deck summon flags have one key per seat in FFA and per team in Tag (Q6).
local function mp_xyz_damage()
	local monsters=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i)
		-- Tag reads include the partner's field; merge cards so each monster counts once.
		monsters:Merge(Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsXyzMonster),tp_i,LOCATION_MZONE,0,nil))
	end)
	return 400*#monsters
end
function s.mp_damtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,PLAYER_ALL,mp_xyz_damage())
end
function s.mp_damop(e,tp,eg,ep,ev,re,r,rp)
	local damage=mp_xyz_damage()
	if damage<=0 then return end
	aux.MPForEachDuelistFromTurn(function(tp_i) Duel.Damage(tp_i,damage,REASON_EFFECT,true) end)
	Duel.RDComplete()
end
function s.mp_summon_limit(e,c,summon_player)
	return c:IsLocation(LOCATION_EXTRA) and not c:IsSetCard(SET_NUMBER)
		and e:GetHandler():HasFlagEffect(id+aux.MPKey(summon_player),2)
end
function s.mp_summon_count(e,tp,eg,ep,ev,re,r,rp)
	local seen={}
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local key=aux.MPKeyOfSeat(seat_i)
		if seen[key] then return end
		seen[key]=true
		for sc in eg:Iter() do
			if sc:GetSummonPlayer()==tp_i and sc:IsSummonLocation(LOCATION_EXTRA)
				and (not sc:IsSetCard(SET_NUMBER) or sc:IsFacedown()) then
				e:GetHandler():RegisterFlagEffect(id+key,RESETS_STANDARD_PHASE_END,0,1)
			end
		end
	end)
end
function s.mp_summon_left(e,re,tp)
	return math.max(2-e:GetHandler():GetFlagEffect(id+aux.MPKey(tp)),0)
end
local mp_initial=s.initial_effect
function s.initial_effect(c)
	local register=Card.RegisterEffect
	Card.RegisterEffect=function(card,eff,...)
		if card==c then
			local code=eff:GetCode()
			if code==EVENT_PHASE+PHASE_END then
				eff:SetTarget(s.mp_damtg)
				eff:SetOperation(s.mp_damop)
			elseif code==EFFECT_CANNOT_SPECIAL_SUMMON then eff:SetTarget(s.mp_summon_limit)
			elseif code==EVENT_SPSUMMON_SUCCESS then eff:SetOperation(s.mp_summon_count)
			elseif code==EFFECT_LEFT_SPSUMMON_COUNT then eff:SetValue(s.mp_summon_left) end
		end
		return register(card,eff,...)
	end
	local ok,err=pcall(mp_initial,c)
	Card.RegisterEffect=register
	if not ok then error(err,0) end
end
