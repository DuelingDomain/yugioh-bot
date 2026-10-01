if not aux.MPKey then return end
-- Life Absorbing Machine: per-player table: one slot per seat (FFA) or team (Tag); a global writer uses the real seat, a handler its own key (aux.MPKey). Two lists (this turn, last turn) replace s[p] and s[p+2].
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
		for k=0,3 do store[k]={} end
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
			return {}
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
-- stock: s[p] is the list of LP costs that player p paid this turn and s[p+2] the list of the last turn of p: that is s[2] and s[3] for
-- the players 2 and 3 too. The lists are kept per key (seat in FFA, team in Tag) in s.mpnow and s.mpprev, and the turn player moves its
-- list at the turn end. (The stock reset still runs on the raw table s: it writes only s[2..5] and nothing reads them.)
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	if ep==Duel.GetTurnPlayer() then
		local val=math.ceil(ev/2)
		table.insert(s.mpnow[ep],val)
	end
end
function s.mp_rotate()
	local p=Duel.GetTurnPlayer()
	s.mpprev[p]={table.unpack(s.mpnow[p])}
	s.mpnow[p]={}
end
function s.rectg(e,tp,eg,ep,ev,re,r,rp,chk)
	local c=e:GetHandler()
	local last=s.mpprev[tp]
	if chk==0 then return #last>0 and (c:GetFlagEffect(id)==0 or last[c:GetFlagEffectLabel(id)+1]) end
	local rec
	if c:GetFlagEffect(id)==0 then
		rec=last[1]
		c:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_STANDBY,0,1,1)
	else
		rec=last[c:GetFlagEffectLabel(id)+1]
		c:SetFlagEffectLabel(id,c:GetFlagEffectLabel(id)+1)
	end
	Duel.SetTargetPlayer(tp)
	Duel.SetTargetParam(rec)
	Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,rec)
end
local mp_ie_rotate=s.initial_effect
function s.initial_effect(c)
	mp_ie_rotate(c)
	if not s.mp_rotate_ready then
		s.mp_rotate_ready=true
		aux.AddValuesReset(s.mp_rotate)
	end
end
local mp_ie=s.initial_effect
function s.initial_effect(c)
	mp_ie(c)
	if s.mp_seat_ready then return end
	s.mp_seat_ready=true
	mp_seat_table(s.mpnow)
	mp_seat_table(s.mpprev)
end
