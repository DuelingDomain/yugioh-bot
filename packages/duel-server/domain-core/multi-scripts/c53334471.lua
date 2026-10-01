if not aux.MPKey then return end
-- Gozen Match: per-player table: one slot per seat (FFA) or team (Tag); a global writer uses the real seat, a handler its own key (aux.MPKey). The adjust handler loops over every living duelist (stock: the two sides of the owner). The cannot-activate value function still gets a folded player.
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
-- stock: the summon limit reads Duel.GetMatchingGroup(Card.IsFaceup,targetp or sump,LOCATION_MZONE,0,nil). Both values are folded: 1 means
-- EVERY opponent of the owner of the Trap, and a read of a field with the value 1 gives the monsters of all those opponents together (a bound
-- opponent narrows only the hand, the Deck and the Extra Deck), so the limit of one opponent would read the monsters of the others too.
-- The limit reads the field of the duelist that summons: the real seat of the controller of the card (it goes to its own field). A Special Summon
-- to the field of another duelist (sump and targetp differ) keeps the stock read.
function s.sumlimit(e,c,sump,sumtype,sumpos,targetp)
	local seat=Duel.MPSeatOf(c)
	if seat<0 or sump~=targetp then
		local k=s.getattribute(Duel.GetMatchingGroup(Card.IsFaceup,targetp or sump,LOCATION_MZONE,0,nil))
		return k~=0 and c:GetAttribute()~=k
	end
	local limited=false
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if seat_i~=seat then return false end
		local k=s.getattribute(Duel.GetMatchingGroup(Card.IsFaceup,tp_i,LOCATION_MZONE,0,nil))
		limited=k~=0 and c:GetAttribute()~=k
		return true
	end)
	return limited
end
-- stock: the adjust handler keeps the attribute that the player 0 and the player 1 chose in s[0] and s[1]. Each living duelist keeps its own
-- choice (slot per seat in FFA, per team in Tag) and all duelists are checked, not only the two sides of the owner.
function s.acttg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	s.mp_reset_all()
end
function s.adjustop(e,tp,eg,ep,ev,re,r,rp)
	local phase=Duel.GetCurrentPhase()
	if (phase==PHASE_DAMAGE and not Duel.IsDamageCalculated()) or phase==PHASE_DAMAGE_CAL then return end
	local readjust=false
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local g=Duel.GetMatchingGroup(Card.IsFaceup,tp_i,LOCATION_MZONE,0,nil)
		if #g==0 then
			s[tp_i]=0
		else
			local att=s.getattribute(g)
			if (att&att-1)~=0 then
				if s[tp_i]==0 or (s[tp_i]&att)==0 then
					Duel.Hint(HINT_SELECTMSG,tp_i,aux.Stringid(id,0))
					att=Duel.AnnounceAttribute(tp_i,1,att)
				else att=s[tp_i] end
			end
			g:Remove(s.rmfilter,nil,att)
			s[tp_i]=att
		end
		if #g>0 then
			Duel.SendtoGrave(g,REASON_RULE,PLAYER_NONE,tp_i)
			readjust=true
		end
	end)
	if readjust then Duel.Readjust() end
end
local mp_ie=s.initial_effect
function s.initial_effect(c)
	mp_ie(c)
	if s.mp_seat_ready then return end
	s.mp_seat_ready=true
	mp_seat_table(s)
	aux.AddValuesReset(s.mp_reset_all)
end
