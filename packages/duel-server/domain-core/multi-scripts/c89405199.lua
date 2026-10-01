if not aux.MPKey then return end
local mp_initial=s.initial_effect
function s.initial_effect(c)
	mp_initial(c)
	aux.GlobalCheck(s,function()
		local ge1=Effect.CreateEffect(c)
		ge1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
		ge1:SetCode(EVENT_DRAW)
		ge1:SetOperation(s.mp_drawcheck)
		Duel.RegisterEffect(ge1,0)
	end)
end
-- the stock draw step does nothing: the global check below reads the real drawing seat
function s.drop(e,tp,eg,ep,ev,re,r,rp)
end
function s.mp_drawcheck(e,tp,eg,ep,ev,re,r,rp)
	if (r&REASON_EFFECT)==0 then return end
	local k=aux.MPKeyOfSeat(ep)
	if not Duel.MPSeat or k<0 or ep<0 or ep>3 then return end
	for seat=0,3 do
		local g=Duel.GetMatchingGroup(function(c) return c:IsCode(id) and c:IsFaceup() and not c:IsDisabled() end,seat,LOCATION_SZONE,0,nil)
		for c in g:Iter() do
			local flag=id+k
			local ct=c:GetFlagEffectLabel(flag)
			if ct then
				c:SetFlagEffectLabel(flag,ct+ev)
			else
				c:RegisterFlagEffect(flag,RESETS_STANDARD_PHASE_END,0,1,ev)
			end
		end
	end
end
function s.damcon(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	for k=0,3 do
		if c:GetFlagEffect(id+k)>0 then return true end
	end
	return false
end
function s.damtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,PLAYER_ALL,0)
end
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not c:IsRelateToEffect(e) then return end
	local mask=0
	for k=0,3 do
		if c:GetFlagEffect(id+k)>0 then mask=mask|(1<<k) end
	end
	local done={}
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local k=aux.MPKeyOfSeat(seat_i)
		if not done[k] and (mask&(1<<k))~=0 then
			done[k]=true
			local ct=c:GetFlagEffectLabel(id+k)
			if ct then Duel.Damage(tp_i,ct*500,REASON_EFFECT,true) end
		end
	end)
	Duel.RDComplete()
end
