MP_OVERLAY_ACTIVE = true
if not Duel.MPBindOpponent then return end
-- Helpers for the multiplayer card overlay (F7, design 2.A.7). Loaded at 3 or 4 seats only, after utility.lua and domain.lua.
-- Duel.MPMode(): 0 = two seats, 1 = free-for-all, 2 = Tag. Each helper returns fn itself at two seats.

-- TRUE/FALSE checks only. Condition-safe: it never asks. Nothing bound: it runs fn once per living opponent
-- and is true when ANY one opponent passes. Bound: it runs fn once on the bound opponent.
-- Tag: the opposing team is one joined side, so fn runs once with no window.
function aux.MPAny(fn)
	return function(...)
		if Duel.MPMode()~=1 then return fn(...) end
		if Duel.MPBound() then
			Duel.MPWindow(0)
			local r=fn(...)
			Duel.MPWindowEnd()
			return r
		end
		Duel.MPNeedPick()
		for i=1,Duel.MPOppCount() do
			Duel.MPWindow(i)
			local r=fn(...)
			Duel.MPWindowEnd()
			if r then return true end
		end
		return false
	end
end

-- NUMBERS (a count or a sum that is used as ct). The link MUST have a bound opponent: this never loops.
function aux.MPValue(fn)
	return function(...)
		if Duel.MPMode()~=1 then return fn(...) end
		Duel.MPAssertBound()
		Duel.MPWindow(0)
		local r=fn(...)
		Duel.MPWindowEnd()
		return r
	end
end

-- Cost, target or operation step: bind one opponent (it may ask), then run fn.
-- FFA: window ONE around the whole fn. Tag: it binds and opens no window (the joined opposing field).
function aux.MPOne(fn)
	return function(...)
		if Duel.MPMode()==0 then return fn(...) end
		Duel.MPBindOpponent(true)
		if Duel.MPMode()==2 then return fn(...) end
		Duel.MPWindow(0)
		local r=fn(...)
		Duel.MPWindowEnd()
		return r
	end
end

-- Chooser card, condition or target (chk==0): the activator picks the opponent at activation (FFA and Tag).
function aux.MPPick(fn)
	return function(...)
		if Duel.MPMode()~=0 and not Duel.MPBound() then Duel.MPNeedPick() end
		return fn(...)
	end
end

-- Chooser card, target or cost step with chk. The real step (chk~=0) binds and runs in window ONE (MPOne).
-- chk==0, nothing bound: the first run asks for the pick (MPPick); fn sees every opponent, so it only tells that SOME opponent has a legal target.
-- chk==0, bound (the per-opponent probe run, or a link that is already bound): fn runs in window ONE (MPOne), so an opponent with no legal target is not offered in the pick.
function aux.MPTarget(fn)
	local pick,one=aux.MPPick(fn),aux.MPOne(fn)
	return function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
		if chk==0 and not (Duel.MPMode()~=0 and Duel.MPBound()) then return pick(e,tp,eg,ep,ev,re,r,rp,chk,chkc) end
		return one(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	end
end

-- "All" or "each" opponent cards, and continuous (ADJUST) cards: fn(i,...) runs once per living opponent.
-- Seat windows work in FFA and in Tag: one duelist per run, never the joined field. Two seats: fn(0,...) once.
function aux.MPEachOpponent(fn)
	return function(...)
		if Duel.MPMode()==0 then return fn(0,...) end
		for i=1,Duel.MPOppCount() do
			Duel.MPWindow(i)
			fn(i,...)
			Duel.MPWindowEnd()
		end
	end
end

-- R1 "each duelist" (Q3) and R2 "state per seat" (Q6). They need the seat functions of core patch 0053 (Duel.MPNthDuelist, MPSeat,
-- MPSeatOf, MPBindSeat). Without them, or at two seats, each helper does the stock thing and never rebinds.

-- The team id of every seat, read once at load (no scope yet, so Duel.MPSeat gives the team in Tag and the seat in FFA).
local mp_team_of={}
if Duel.MPSeat and Duel.MPMode()~=0 then
	for seat=0,3 do mp_team_of[seat]=Duel.MPSeat(seat) end
end
-- (the formats put the seats of a Tag team on alternate seats: the fallback when the table has no entry)
local function mp_team(seat) return mp_team_of[seat] or seat%2 end

-- Runs fn(tp_i,seat_i) once for every LIVING duelist in turn order from the duelist that runs the effect (the Tag partner is one too,
-- a defeated duelist is skipped). tp_i is the Lua player value of that duelist (FFA: 0, Tag: its team id), seat_i its real seat.
-- Inside fn the scope is that duelist: write "tp_i" where the stock script writes "tp" and "1-tp_i" for its opponent. fn uses only
-- tp_i and seat_i, never a value read before the loop (it was read for another duelist). fn returns true to stop the loop.
-- The loop gives the scope back (Duel.MPNthDuelist(0)) on every exit: the end, a stop, and a prompt inside fn keeps the rebind.
-- A Lua error is closed by the core (scope_guard). Two seats (or no seat functions): fn(0,0) for the duelist, then fn(1,1) for the other.
function aux.MPForEachDuelist(fn)
	if Duel.MPMode()==0 or not Duel.MPNthDuelist then
		if not fn(0,0) then fn(1,1) end
		return
	end
	local tag=Duel.MPMode()==2
	local i=1
	while true do
		local ok,seat=Duel.MPNthDuelist(i)
		if not ok then break end
		local stop=fn(tag and mp_team(seat) or 0,seat)
		if stop then break end
		i=i+1
	end
	Duel.MPNthDuelist(0)
end

-- All living duelists choose from the real turn seat, in normal turn order.
-- Keep MPForEachDuelist actor-first for effects whose card text requires it.
function aux.MPForEachDuelistFromTurn(fn)
	if Duel.MPMode()==0 or not Duel.MPNthDuelist then return aux.MPForEachDuelist(fn) end
	local turn=Duel.MPTurnSeat()
	local order,first={},1
	local i=1
	while true do
		local ok,seat=Duel.MPNthDuelist(i)
		if not ok then break end
		order[#order+1]={index=i,seat=seat}
		if seat==turn then first=#order end
		i=i+1
	end
	Duel.MPNthDuelist(0)
	for offset=0,#order-1 do
		local item=order[(first+offset-1)%#order+1]
		local ok,seat=Duel.MPNthDuelist(item.index)
		if ok and fn(Duel.MPMode()==2 and mp_team(seat) or 0,seat) then break end
	end
	Duel.MPNthDuelist(0)
end

-- The same loop for code that can run in a GLOBAL effect (a check that a card registers in initial_effect, a turn-end or adjust handler).
-- A global effect has no scope player, so Duel.MPNthDuelist gives nothing there and aux.MPForEachDuelist would run fn zero times.
-- Here the Lua values are real seats (no fold): fn(tp_i,seat_i) runs for every seat 0 to 3 that is in the duel and has LP > 0, in seat
-- order, and fn must use seat_i only (tp_i is the Tag team id of the seat, or 0 in FFA). Inside a card effect (a scope player exists)
-- this IS aux.MPForEachDuelist. Two seats: fn(0,0) then fn(1,1), as MPForEachDuelist does.
-- LP > 0 is NOT the same as living: the core keeps the LP of a seat that is out by a deck-out or a surrender (field::eliminate only sets
-- `eliminated`), and no Lua query gives that state in a global effect. Such a seat is also given to fn. This is harmless for a flag: every
-- card of an eliminated seat has left the game, so no effect reads its flag. fn must not count the seats it is given as living duelists.
function aux.MPEachSeat(fn)
	if Duel.MPMode()==0 or not Duel.MPNthDuelist or Duel.MPNthDuelist(1) then
		if Duel.MPMode()~=0 and Duel.MPNthDuelist then Duel.MPNthDuelist(0) end
		return aux.MPForEachDuelist(fn)
	end
	local tag=Duel.MPMode()==2
	for seat=0,3 do
		local lp=Duel.GetLP(seat)
		if lp and lp>0 then
			if fn(tag and mp_team(seat) or 0,seat) then break end
		end
	end
end

-- True when fn(tp_i,seat_i) is true for every living duelist (the loop stops at the first false). Same rules for fn as in MPForEachDuelist.
function aux.MPAllDuelists(fn)
	local all=true
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if not fn(tp_i,seat_i) then all=false return true end
	end)
	return all
end

-- True when fn(tp_i,seat_i) is true for at least one living duelist (the loop stops at the first true).
function aux.MPAnyDuelist(fn)
	local any=false
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if fn(tp_i,seat_i) then any=true return true end
	end)
	return any
end

-- The key of a player value p for a flag or a table that is kept per player: the seat in FFA, the team in Tag (Q6).
-- Without Duel.MPSeat (or at two seats) it is p itself.
function aux.MPKey(p)
	if Duel.MPSeat and Duel.MPMode()~=0 then return Duel.MPSeat(p) end
	return p
end

-- The key (as aux.MPKey gives it) of a real seat: the seat in FFA, the team in Tag. aux.MPKey(tp) before a loop and
-- aux.MPKeyOfSeat(seat_i) inside it tell if a duelist is on the side of the effect (equal) or an opponent (different).
function aux.MPKeyOfSeat(seat)
	if Duel.MPMode()==2 then return mp_team(seat) end
	return seat
end

-- True when fn(tp_i,seat_i) is true for at least one living OPPONENT of the duelist that runs the effect (a seat or team key other than
-- the key of tp). It never asks for a pick (aux.MPAny does, in FFA). A value of the own side (a count, LP) is read BEFORE the call and
-- fn compares it with the opponent that fn sees; that one value is meant for the own side. Same rules for fn as in MPForEachDuelist.
function aux.MPAnyOpponent(tp,fn)
	local me=aux.MPKey(tp)
	return aux.MPAnyDuelist(function(tp_i,seat_i)
		return aux.MPKeyOfSeat(seat_i)~=me and fn(tp_i,seat_i)
	end)
end

-- Decision-only "your opponent": call during resolution, after the activator prepares the choices.
-- Use the ordinary option prompt with the same seat descriptors as the core's declaration prompt.
-- Unlike a declaration, this ignores an event/chain opponent: any living opponent can decide.
-- MPBindSeat keeps that real chooser across subsequent prompts, including in Tag; patch 0100 recognizes this resolution-only binding.
function aux.MPChooseOpponent(tp)
	if Duel.MPMode()==0 then return true end
	local me=aux.MPKey(tp)
	local seats={}
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if aux.MPKeyOfSeat(seat_i)~=me then seats[#seats+1]=seat_i end
	end)
	table.sort(seats)
	Duel.MPWindowEnd()
	if #seats==0 then Duel.MPBindSeat(-1) return false end
	local seat=seats[1]
	if #seats>1 then
		local options={}
		for i,opponent in ipairs(seats) do options[i]=0xfffe0000+opponent end
		seat=seats[Duel.SelectOption(tp,table.unpack(options))+1]
	end
	return seat~=nil and Duel.MPBindSeat(seat)
end

-- The Lua value of the own side of the duelist that runs the effect: FFA 0, Tag its team id. A seat that Duel.MPBindSeat accepts is a
-- living opponent, so the own team is the other one. It leaves no bind behind.
local function mp_own_value()
	if Duel.MPMode()~=2 then return 0 end
	local own=0
	for seat=0,3 do
		if Duel.MPBindSeat(seat) then own=1-mp_team(seat) break end
	end
	Duel.MPBindSeat()
	return own
end

-- Puts the scope on the living duelist with the real seat `seat` (Duel.MPNthDuelist counts from the duelist that runs the effect).
-- The duelist that runs the effect itself needs no rebind. Gives true when the scope is that duelist's now, false (scope given back) when
-- no living duelist has that seat. Outside any duelist scope (no first duelist) it gives true and rebinds nothing: the stock reads.
-- The caller gives the scope back with Duel.MPNthDuelist(0).
local function mp_enter_seat(seat)
	local i=1
	while true do
		local ok,s=Duel.MPNthDuelist(i)
		if not ok then
			if i==1 then return true end
			break
		end
		if s==seat then
			if i==1 then Duel.MPNthDuelist(0) end
			return true
		end
		i=i+1
	end
	Duel.MPNthDuelist(0)
	return false
end

-- "The controller of the card" reads: fn(sg,seat,p) runs once for every real controller seat of the cards in g, in seat order.
-- sg is the part of g that this duelist controls, seat the real seat (Duel.MPSeatOf), p the Lua player value of the controller
-- (the value that c:GetControler() gives). For an opponent controller the Lua value 1 is bound to that seat (Duel.MPBindSeat) while fn
-- runs, so Duel.Damage(p,...) and the other reads of "1" reach that duelist, not "the next opponent". For the Tag partner of the duelist
-- that runs the effect the scope is rebound to the partner (Duel.MPNthDuelist) while fn runs, so p (the team value) reaches the partner
-- and not the activator. The duelist that runs the effect runs with no bind. A controller that is not a living duelist is skipped.
-- fn returns true to stop. Bind and rebind are removed after every fn and on every exit (they replace a bind that the caller made).
-- Do not call it inside aux.MPForEachDuelist (the scope of that loop would be given back). Two seats (or no seat functions): the same
-- loop with the real controller, no bind. A core with Duel.MPBindSeat and no Duel.MPNthDuelist: the partner has no rebind. FFA: no rebind
-- (the only controller of the own side is the duelist that runs the effect).
function aux.MPForEachController(g,fn)
	local order={}
	local by={}
	for c in aux.Next(g) do
		local seat=Duel.MPSeatOf and Duel.MPSeatOf(c) or c:GetControler()
		if seat>=0 then
			if not by[seat] then
				by[seat]=Group.CreateGroup()
				order[#order+1]=seat
			end
			by[seat]:AddCard(c)
		end
	end
	table.sort(order)
	local bind=Duel.MPBindSeat and Duel.MPMode()~=0
	local rebind=bind and Duel.MPMode()==2 and Duel.MPNthDuelist
	local own=bind and mp_own_value()
	for _,seat in ipairs(order) do
		local sg=by[seat]
		local p=sg:GetFirst():GetControler()
		local ok=true
		local entered=false
		if bind then
			if p==own then
				Duel.MPBindSeat()
				if rebind then
					ok=mp_enter_seat(seat)
					entered=ok
				end
			else
				ok=Duel.MPBindSeat(seat)
			end
		end
		local stop=ok and fn(sg,seat,p)
		if entered then Duel.MPNthDuelist(0) end
		if stop then break end
	end
	if bind then Duel.MPBindSeat() end
end

-- "An opponent's monster attacks directly" (a direct attack AT YOU). fn is the stock condition, kept as it is; it holds for a direct attack of
-- any opponent, because FFA folds all opponents into the Lua value 1 and a script cannot tell an attack at itself from an attack at another
-- opponent. This wrapper adds the real target: Duel.MPAttackedSeat (core) is the seat that the direct attack goes to, and it must be the seat
-- of the card that holds the effect. Two seats and Tag: fn itself (Tag: the stock 1-tp is the team value, so fn already means an attack at
-- your team; the partner shares the life points and the field side).
-- Without that core function (an older core) the attack counts when you are the only seat it can go to: a direct attack goes to a seat with
-- no monster, so if another seat that is not the attacker has no monster too, the attack may be at that seat and it does not count.
function aux.MPAttackedAtMe(fn)
	return function(e,tp,...)
		if not fn(e,tp,...) then return false end
		if Duel.MPMode()~=1 then return true end
		if Duel.MPAttackedSeat and Duel.MPSeatOf then
			return Duel.MPAttackedSeat()==Duel.MPSeatOf(e:GetHandler())
		end
		tp=tp or e:GetHandlerPlayer() -- a condition with the form (e) only gets no tp
		local atk=Duel.GetAttacker()
		local other=false
		for i=1,Duel.MPOppCount() do
			Duel.MPWindow(i)
			if not Duel.GetFieldGroup(tp,0,LOCATION_ALL):IsContains(atk) and Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)==0 then other=true end
			Duel.MPWindowEnd()
		end
		return not other
	end
end

-- A global flag shared by every seat: literal 0 is one memory slot, not necessarily seat 0.
-- Read it from the first key MPEachSeat visits. Register flags and write labels once per key.
-- These replacements last only for this operation; handler effects keep their normal player reads.
function aux.MPGlobalFlagOperation(op)
	if Duel.MPMode()==0 then return op end
	return function(...)
		local seats,seen={},{}
		aux.MPEachSeat(function(_,seat)
			local key=aux.MPKeyOfSeat(seat)
			if not seen[key] then seen[key]=true seats[#seats+1]=seat end
		end)
		local first=seats[1] or 0
		local rf,gf,hf,gl,sl=Duel.RegisterFlagEffect,Duel.GetFlagEffect,Duel.HasFlagEffect,Duel.GetFlagEffectLabel,Duel.SetFlagEffectLabel
		Duel.GetFlagEffect=function(pl,...) return gf(pl==0 and first or pl,...) end
		Duel.HasFlagEffect=function(pl,...) return hf(pl==0 and first or pl,...) end
		Duel.GetFlagEffectLabel=function(pl,...) return gl(pl==0 and first or pl,...) end
		Duel.RegisterFlagEffect=function(pl,...)
			if pl~=0 then return rf(pl,...) end
			local value
			for _,seat in ipairs(seats) do
				local flag=rf(seat,...)
				value=value or flag
			end
			return value
		end
		Duel.SetFlagEffectLabel=function(pl,...)
			if pl~=0 then return sl(pl,...) end
			local value=false
			for _,seat in ipairs(seats) do
				local changed=sl(seat,...)
				value=changed or value
			end
			return value
		end
		local result=table.pack(pcall(op,...))
		Duel.RegisterFlagEffect,Duel.GetFlagEffect,Duel.HasFlagEffect,Duel.GetFlagEffectLabel,Duel.SetFlagEffectLabel=rf,gf,hf,gl,sl
		if not result[1] then error(result[2],0) end
		return table.unpack(result,2,result.n)
	end
end

-- Duel.MPActionSeat() keeps the original actor through a recipient rebind.
-- Its optional argument is a REAL seat from MPSeatOf/MPOwnerSeat or the host.
-- Never pass folded tp or 1-tp. In a card effect use no argument for the actor.
-- The marker can name a chooser, a ConfirmCards viewer, or a summon player/destination.

-- Shared FFA4 geometry compares real seats. Other formats keep the stock tests.
function aux.MPGeometryShared()
 return Duel.MPSharedZones and Duel.MPSharedZones()
end
function aux.MPGeometryPreviousFilter(fn)
	return function(c,tp,...)
		if aux.MPGeometryShared() then
			-- Previous-Link filters pass a Link card instead of a Lua player.
			-- Read that card's physical mask and restore the exact seat override.
			if type(tp)=="Card" then
				local ec=tp
				if c:IsLocation(LOCATION_MZONE) then return fn(c,ec,...) end
				local saved=Duel.MPSeatBinding()
				local own=Duel.MPSeat(0)
				local seat=Duel.MPSeatOf(ec)
				if seat~=own then Duel.MPBindSeat(seat) end
				local cp=ec:GetControler()
				local same=c:IsPreviousControler(ec)
				local across=c:IsPreviousAcross(cp)
				local result=false
				if same or across then
					if seat==own then Duel.MPBindSeat(Duel.MPAcrossSeat(seat)) end
					local mask=ec:GetLinkedZone()
					if not same then mask=mask>>16 end
					result=(mask&(1<<c:GetPreviousSequence()))~=0
				end
				if saved==255 then Duel.MPBindSeat() else Duel.MPBindSeat(saved) end
				return result
			end
			if not c:IsPreviousControler(tp) and not c:IsPreviousAcross(tp) then return false end
		end
		return fn(c,tp,...)
	end
end
function aux.MPGeometryChainFilter(fn)
 return function(e,tp,eg,ep,ev,re,r,rp,...)
  if aux.MPGeometryShared() and re then
   local seat=Duel.MPChainSeat(ev)
   local own=Duel.MPSeat(tp)
   if seat~=own and seat~=Duel.MPAcrossSeat(own) then return false end
  end
  return fn(e,tp,eg,ep,ev,re,r,rp,...)
 end
end
local mp_get_to_be_linked_zone=Card.GetToBeLinkedZone
function Card.GetToBeLinkedZone(tc,c,tp,clink,emz)
 if aux.MPGeometryShared() and not tc:IsControler(tp) and not tc:IsAcross(tp) then return 0 end
 return mp_get_to_be_linked_zone(tc,c,tp,clink,emz)
end

-- A trigger mask describes the event cards, independent of the reason player.
-- Restore the exact temporary seat override before any resource action runs.
function aux.MPGeometryLinkedZone(c,cp)
 if not aux.MPGeometryShared() then
  if cp==nil then return c:GetLinkedZone() end
  return c:GetLinkedZone(cp)
 end
 local previous=Duel.MPSeatBinding()
 local across=Duel.MPAcrossSeat(Duel.MPSeat(0))
 Duel.MPBindSeat(across)
 local zone=cp==nil and c:GetLinkedZone() or c:GetLinkedZone(cp)
 if previous==255 then Duel.MPBindSeat() else Duel.MPBindSeat(previous) end
 return zone
end

-- Official Link triggers share this previous-controller filter.
aux.zptfilter=aux.MPGeometryPreviousFilter(aux.zptfilter)

-- Columns alone use the FFA3 house rule. Link helpers above keep across geometry.
function aux.MPColumnGeometry()
	return Duel.MPColumnGeometry and Duel.MPColumnGeometry() or aux.MPGeometryShared()
end
function aux.MPColumnPeerSeat(seat)
	if Duel.MPColumnPeerSeat then return Duel.MPColumnPeerSeat(seat) end
	return Duel.MPAcrossSeat(seat)
end
function aux.MPColumnChainFilter(fn)
	return function(e,tp,eg,ep,ev,re,r,rp,...)
		if aux.MPColumnGeometry() and re then
			local seat=Duel.MPChainSeat(ev)
			local own=Duel.MPSeat(tp)
			if seat~=own and seat~=aux.MPColumnPeerSeat(own) then return end
		end
		return fn(e,tp,eg,ep,ev,re,r,rp,...)
	end
end

-- Opt in only the named activated operations, only in FFA3. This also covers
-- operations that do not read a column until after a card or zone selection.
-- Keep continuous descendants unmarked; the last two living seats need no opt-in.
function aux.MPColumnEffects(initial,operations)
	return function(source,...)
		local c=type(source)=="Effect" and source:GetHandler() or source
		if not Duel.MPColumnGeometry or not Duel.MPColumnGeometry() or aux.MPGeometryShared() then return initial(source,...) end
		local register=Card.RegisterEffect
		Card.RegisterEffect=function(card,e,...)
			if card==c and e:IsHasType(EFFECT_TYPE_ACTIONS) and not e:IsHasType(EFFECT_TYPE_CONTINUOUS) then
				e:SetColumnPeer(false) -- a Clone can inherit another operation's opt-in
				for _,operation in ipairs(operations) do
					if e:GetOperation()==operation then
						e:SetColumnPeer(true)
						e:SetTarget(aux.MPTarget(e:GetTarget() or function() return true end))
						break
					end
				end
			end
			return register(card,e,...)
		end
		local ok,result=pcall(initial,source,...)
		Card.RegisterEffect=register
		if not ok then error(result,0) end
		return result
	end
end

-- Resolve exact seats before choosing the stock own-column comparison.
local mp_is_column=Card.IsColumn
function Card.IsColumn(c,seq,tp,loc,source)
	if not aux.MPColumnGeometry() or not c:IsOnField() then return mp_is_column(c,seq,tp,loc) end
	local seat=Duel.MPSeatOf(c)
	-- An immunity value can run in an unbound scope. Its source effect carries
	-- an exact card or chain seat; never infer it from an unbound Lua 1.
	local origin=seat
	if type(source)=="Effect" then
		if Chain.IsTriggeringEffect(0,source) then origin=Duel.MPChainSeat(0)
		else origin=Duel.MPSeatOf(source:GetOwner()) end
	elseif type(source)=="Card" then origin=Duel.MPSeatOf(source)
	elseif tp~=nil then
		if tp~=0 and not Duel.MPBound() and Duel.MPSeatBinding()==255 then
			if aux.MPGeometryShared() then return false end
			origin=aux.MPColumnPeerSeat(Duel.MPSeat(0))
		else origin=Duel.MPSeat(tp) end
	end
	if seat==origin then return mp_is_column(c,seq,c:GetControler(),loc) end
	if seat~=aux.MPColumnPeerSeat(origin) then return false end
	-- Normalize the source sequence before mirroring; the stock call normalizes c.
	local source_loc=loc or c:GetLocation()
	if source_loc==LOCATION_MZONE then
		if seq==5 then seq=1 elseif seq==6 then seq=3 end
	elseif seq==6 then seq=5 end
	return mp_is_column(c,4-seq,c:GetControler(),loc)
end

-- Fork-private player effect. Keep the C++ constant equal.
EFFECT_CANNOT_BE_DIRECT_ATTACKED=0x7F000101

-- Conditional direct attacks: inspect each prospective FFA defender, then the attacked seat.
-- MPAttackQuerySeat exists only during the host target query; the normal battle uses MPAttackedSeat.
function aux.MPDirectAttackCondition(fn)
 return function(e)
  if Duel.MPMode()~=1 then return fn(e) end
  local c=e:GetHandler()
  local seat=aux.MPAttackQuerySeat
  if seat==nil and Duel.GetAttacker()==c and Duel.GetAttackTarget()==nil and Duel.MPAttackedSeat then seat=Duel.MPAttackedSeat() end
  if seat~=nil then
   local saved=Duel.MPSeatBinding()
   Duel.MPBindSeat(seat)
   Duel.MPWindow(0)
   local result=fn(e)
   Duel.MPWindowEnd()
   if saved==255 then Duel.MPBindSeat() else Duel.MPBindSeat(saved) end
   return result
  end
  for i=1,Duel.MPOppCount() do
   Duel.MPWindow(i)
   local result=fn(e)
   Duel.MPWindowEnd()
   if result then return true end
  end
  return false
 end
end
