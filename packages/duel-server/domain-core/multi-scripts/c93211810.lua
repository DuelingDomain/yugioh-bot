if not aux.MPKey then return end
-- Sonic Boom: per-player table: one slot per seat (FFA) or team (Tag); a global writer uses the real seat, a handler its own key (aux.MPKey).
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
		for k=0,3 do store[k]=0 end
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
			return 0
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
local mp_ie=s.initial_effect
function s.initial_effect(c)
	mp_ie(c)
	if s.mp_seat_ready then return end
	s.mp_seat_ready=true
	mp_seat_table(s)
	aux.AddValuesReset(s.mp_reset_all)
end
