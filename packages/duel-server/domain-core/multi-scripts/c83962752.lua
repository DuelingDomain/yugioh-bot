if not aux.MPKey then return end
-- Synchro Panic: destroyed-Synchro groups per key (seat in FFA, team in Tag); the registering check loops over the seats 0..3 (stock: 0 and 1) and compares reason keys.
local mp_resets={}
local mp_stores={}
-- the slot of a real seat (a value function gets a folded player value: use the seat of a card instead)
function s.mp_slot(t,seat)
	return mp_stores[t][aux.MPKeyOfSeat(seat)]
end
function s.mp_reset_all()
	for _,f in ipairs(mp_resets) do f() end
end
local function mp_seat_table(t)
	local store={}
	local function reset()
		for k=0,3 do store[k]=(function() local g=Group.CreateGroup() g:KeepAlive() return g end)() end
	end
	reset()
	mp_stores[t]=store
	rawset(t,0,nil)
	rawset(t,1,nil)
	local old=getmetatable(t)
	local meta={}
	if old then for k,v in pairs(old) do meta[k]=v end end
	local old_index=old and old.__index
	local old_newindex=old and old.__newindex
	meta.__index=function(self,k)
		if k==0 or k==1 or k==2 or k==3 then
			local key=aux.MPKey(k)
			if key>=0 then return store[key] end
			return (function() local g=Group.CreateGroup() g:KeepAlive() return g end)()
		end
		if type(old_index)=="function" then return old_index(self,k) end
		if old_index then return old_index[k] end
	end
	meta.__newindex=function(self,k,v)
		if k==0 or k==1 or k==2 or k==3 then
			local key=aux.MPKey(k)
			if key>=0 then store[key]=v end
		elseif type(old_newindex)=="function" then
			old_newindex(self,k,v)
		elseif old_newindex then
			old_newindex[k]=v
		else
			rawset(self,k,v)
		end
	end
	setmetatable(t,meta)
	mp_resets[#mp_resets+1]=reset
end
-- stock: s.desgroup[0] and s.desgroup[1] keep the Synchro Monsters of the player 0 and 1 that were destroyed. The registering effect is
-- global and sees the real seats, so it loops over all four seats. The groups are kept per key (seat in FFA, team in Tag) and are not
-- reset at the turn end (the stock script does not). "Destroyed by an opponent's effect" compares the keys of the two seats.
function s.mp_cfilter(c,p,e)
	local rp=c:GetReasonPlayer()
	return c:IsType(TYPE_SYNCHRO) and c:IsPreviousPosition(POS_FACEUP)
		and c:IsPreviousLocation(LOCATION_MZONE) and c:IsPreviousControler(p)
		and (c:IsReason(REASON_BATTLE) or (c:IsReason(REASON_EFFECT) and rp<=3 and aux.MPKeyOfSeat(rp)~=aux.MPKeyOfSeat(p)))
		and (not e or c:IsCanBeEffectTarget(e))
end
function s.desgroupregop(e,tp,eg,ep,ev,re,r,rp)
	for p=0,3 do
		local tg=eg:Filter(s.mp_cfilter,nil,p)
		if #tg>0 then
			for tc in tg:Iter() do
				tc:RegisterFlagEffect(id,RESET_CHAIN,0,1)
			end
			if Duel.GetCurrentChain()==0 then s.desgroup[p]:Clear() end
			s.desgroup[p]:Merge(tg)
			s.desgroup[p]:Remove(function(c) return c:GetFlagEffect(id)==0 end,nil)
			Duel.RaiseEvent(s.desgroup[p],EVENT_CUSTOM+id,re,r,rp,p,0)
		end
	end
end
local mp_ie=s.initial_effect
function s.initial_effect(c)
	mp_ie(c)
	if s.mp_seat_ready then return end
	s.mp_seat_ready=true
	mp_seat_table(s.desgroup)
end
