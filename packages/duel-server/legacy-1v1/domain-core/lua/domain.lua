-- Domain Format 1v1: Deck Master Zone is LOCATION_DECKMASTER (0x4000).
-- Do not pretend DMZ is HAND or EXTRA globally.
-- Proper extra-type summons:
--   Fusion.SummonEffTG/OP (extra_proc) and Ritual.Target/Operation (hand_proc)
--   plus a bounded EXTRA matching bridge: a DM candidate is visible only when
--   THAT card's filter invocation both returns true and called
--   Card.IsCanBeSpecialSummoned on that same card with a proper extra mechanic
--   (Fusion/Synchro/Xyz/Link high-byte). Instant Fusion and Rank-Up-Magic
--   Quick Chaos use this bridge. Nil and type-only EXTRA filters stay blind.
--   Nested matching/field-group queries during a candidate trial keep original
--   locations and filters (no further DMZ expansion). Nested callbacks cannot
--   set outer trial.saw, even via closed-over IsCanBeSpecialSummoned.
--   Filter errors restore the trial stack then propagate, same as call_scoped.
-- Main-type inherent SS uses EFFECT_SPSUMMON_PROC range (native in_range).
-- Activated DM effects stay blocked except Main-deck Pendulum scale activation.
-- Materials cannot be taken from the DMZ.
-- Main-deck Pendulum DMs (and non-Pendulum main DMs) may Pendulum Summon from DMZ
-- when otherwise legal. Extra Pendulum DMs must proper-extra-summon, not Pendulum Summon.

LOCATION_DECKMASTER = LOCATION_DECKMASTER or 0x4000

local EXTRA_TYPES = TYPE_FUSION | TYPE_SYNCHRO | TYPE_XYZ | TYPE_LINK
local SUMMON_MECHANIC_MASK = 0xff000000

local extra_proc = 0
local hand_proc = 0
local trial_stack = {}
local nested_query = 0

local function push_extra()
	extra_proc = extra_proc + 1
end
local function pop_extra()
	extra_proc = math.max(0, extra_proc - 1)
end
local function push_hand()
	hand_proc = hand_proc + 1
end
local function pop_hand()
	hand_proc = math.max(0, hand_proc - 1)
end
local function push_nested()
	nested_query = nested_query + 1
end
local function pop_nested()
	nested_query = math.max(0, nested_query - 1)
end

local function summon_mechanic(sumtype)
	return (sumtype or 0) & SUMMON_MECHANIC_MASK
end

local function is_proper_extra_mechanic(sumtype)
	local mechanic = summon_mechanic(sumtype)
	return mechanic == SUMMON_TYPE_FUSION
		or mechanic == SUMMON_TYPE_SYNCHRO
		or mechanic == SUMMON_TYPE_XYZ
		or mechanic == SUMMON_TYPE_LINK
end

local function push_trial(card)
	trial_stack[#trial_stack + 1] = { card = card, saw = false }
end

local function pop_trial()
	local t = trial_stack[#trial_stack]
	trial_stack[#trial_stack] = nil
	return t
end

local function current_trial()
	return trial_stack[#trial_stack]
end

local function call_scoped(push, pop, fn, ...)
	push()
	local ok, a, b, c, d, e, f, g, h = pcall(fn, ...)
	pop()
	if not ok then
		error(a, 0)
	end
	return a, b, c, d, e, f, g, h
end

local function wrap_factory(factory, push, pop)
	if type(factory) ~= "function" then
		return factory
	end
	return function(...)
		local inner = factory(...)
		if type(inner) ~= "function" then
			return inner
		end
		return function(...)
			return call_scoped(push, pop, inner, ...)
		end
	end
end

if Fusion then
	if Fusion.SummonEffTG then
		Fusion.SummonEffTG = wrap_factory(Fusion.SummonEffTG, push_extra, pop_extra)
	end
	if Fusion.SummonEffOP then
		Fusion.SummonEffOP = wrap_factory(Fusion.SummonEffOP, push_extra, pop_extra)
	end
end
if Ritual then
	if Ritual.Target then
		Ritual.Target = wrap_factory(Ritual.Target, push_hand, pop_hand)
	end
	if Ritual.Operation then
		Ritual.Operation = wrap_factory(Ritual.Operation, push_hand, pop_hand)
	end
end
local function with_dmz(loc1, loc2)
	if extra_proc > 0 then
		if loc1 and (loc1 & LOCATION_EXTRA) ~= 0 then
			loc1 = loc1 | LOCATION_DECKMASTER
		end
		if loc2 and (loc2 & LOCATION_EXTRA) ~= 0 then
			loc2 = loc2 | LOCATION_DECKMASTER
		end
	end
	if hand_proc > 0 then
		if loc1 and (loc1 & LOCATION_HAND) ~= 0 then
			loc1 = loc1 | LOCATION_DECKMASTER
		end
		if loc2 and (loc2 & LOCATION_HAND) ~= 0 then
			loc2 = loc2 | LOCATION_DECKMASTER
		end
	end
	return loc1, loc2
end

local function with_extra_dmz(loc1, loc2)
	if loc1 and (loc1 & LOCATION_EXTRA) ~= 0 then
		loc1 = loc1 | LOCATION_DECKMASTER
	end
	if loc2 and (loc2 & LOCATION_EXTRA) ~= 0 then
		loc2 = loc2 | LOCATION_DECKMASTER
	end
	return loc1, loc2
end

local _IsLocation = Card.IsLocation
function Card.IsLocation(c, loc)
	if _IsLocation(c, LOCATION_DECKMASTER) then
		if (loc & LOCATION_DECKMASTER) ~= 0 then
			return true
		end
		local trial = current_trial()
		if trial and trial.card == c and c:IsType(EXTRA_TYPES) and (loc & LOCATION_EXTRA) ~= 0 then
			return true
		end
		if extra_proc > 0 and c:IsType(EXTRA_TYPES) and (loc & LOCATION_EXTRA) ~= 0 then
			return true
		end
		if hand_proc > 0 and not c:IsType(EXTRA_TYPES) and (loc & LOCATION_HAND) ~= 0 then
			return true
		end
		return false
	end
	return _IsLocation(c, loc)
end

local function install_pendulum_wrap()
	if not Pendulum or Pendulum.__domain_hand_wrap then
		return
	end
	if type(Pendulum.Filter) ~= "function" or type(Pendulum.Condition) ~= "function" or type(Pendulum.Operation) ~= "function" then
		return
	end
	Pendulum.__domain_hand_wrap = true
	local orig_filter = Pendulum.Filter
	function Pendulum.Filter(c, ...)
		if c and _IsLocation(c, LOCATION_DECKMASTER) and c:IsType(EXTRA_TYPES) then
			return false
		end
		return orig_filter(c, ...)
	end
	Pendulum.Condition = wrap_factory(Pendulum.Condition, push_hand, pop_hand)
	Pendulum.Operation = wrap_factory(Pendulum.Operation, push_hand, pop_hand)
end


aux = aux or {}
if type(aux.PendulumProcedure) ~= "table" then
	aux.PendulumProcedure = {}
end
Pendulum = Pendulum or aux.PendulumProcedure
if not getmetatable(aux.PendulumProcedure) then
	setmetatable(aux.PendulumProcedure, {
		__newindex = function(t, k, v)
			rawset(t, k, v)
			if k == "Filter" or k == "Condition" or k == "Operation" then
				install_pendulum_wrap()
			end
		end,
	})
end
install_pendulum_wrap()


local _IsCanBeSpecialSummoned = Card.IsCanBeSpecialSummoned
function Card.IsCanBeSpecialSummoned(c, e, sumtype, ...)
	local ok = _IsCanBeSpecialSummoned(c, e, sumtype, ...)
	if nested_query == 0 then
		local trial = current_trial()
		if trial and trial.card == c and ok and is_proper_extra_mechanic(sumtype) then
			trial.saw = true
		end
	end
	return ok
end

local function proof_and_filter(f, dm, ...)
	if type(f) ~= "function" or not dm then
		return false
	end
	push_trial(dm)
	local ok, result = pcall(f, dm, ...)
	local trial = pop_trial()
	if not ok then
		error(result, 0)
	end
	return result and trial and trial.saw
end

local function wrap_extra_dm_filter(f, ...)
	local n = select("#", ...)
	local extra = { ... }
	return function(c)
		if c and _IsLocation(c, LOCATION_DECKMASTER) then
			if not c:IsType(EXTRA_TYPES) then
				return false
			end
			if n > 0 then
				return proof_and_filter(f, c, table.unpack(extra, 1, n))
			end
			return proof_and_filter(f, c)
		end
		if n > 0 then
			return f(c, table.unpack(extra, 1, n))
		end
		return f(c)
	end
end

local function apply_extra_bridge(f, loc1, loc2, ...)
	if current_trial() then
		return f, loc1, loc2, false
	end
	loc1, loc2 = with_dmz(loc1, loc2)
	if extra_proc == 0 and hand_proc == 0 and type(f) == "function" then
		if (loc1 and (loc1 & LOCATION_EXTRA) ~= 0) or (loc2 and (loc2 & LOCATION_EXTRA) ~= 0) then
			loc1, loc2 = with_extra_dmz(loc1, loc2)
			return wrap_extra_dm_filter(f, ...), loc1, loc2, true
		end
	end
	return f, loc1, loc2, false
end

local _GetMatchingGroup = Duel.GetMatchingGroup
function Duel.GetMatchingGroup(f, p, loc1, loc2, ex, ...)
	if current_trial() then
		return call_scoped(push_nested, pop_nested, _GetMatchingGroup, f, p, loc1, loc2, ex, ...)
	end
	local wrapped
	f, loc1, loc2, wrapped = apply_extra_bridge(f, loc1, loc2, ...)
	if wrapped then
		return _GetMatchingGroup(f, p, loc1, loc2, ex)
	end
	return _GetMatchingGroup(f, p, loc1, loc2, ex, ...)
end

local _GetMatchingGroupCount = Duel.GetMatchingGroupCount
function Duel.GetMatchingGroupCount(f, p, loc1, loc2, ex, ...)
	if current_trial() then
		return call_scoped(push_nested, pop_nested, _GetMatchingGroupCount, f, p, loc1, loc2, ex, ...)
	end
	local wrapped
	f, loc1, loc2, wrapped = apply_extra_bridge(f, loc1, loc2, ...)
	if wrapped then
		return _GetMatchingGroupCount(f, p, loc1, loc2, ex)
	end
	return _GetMatchingGroupCount(f, p, loc1, loc2, ex, ...)
end

local _GetFieldGroup = Duel.GetFieldGroup
function Duel.GetFieldGroup(p, loc1, loc2)
	if current_trial() then
		return call_scoped(push_nested, pop_nested, _GetFieldGroup, p, loc1, loc2)
	end
	loc1, loc2 = with_dmz(loc1, loc2)
	return _GetFieldGroup(p, loc1, loc2)
end

local _GetFieldGroupCount = Duel.GetFieldGroupCount
function Duel.GetFieldGroupCount(p, loc1, loc2)
	if current_trial() then
		return call_scoped(push_nested, pop_nested, _GetFieldGroupCount, p, loc1, loc2)
	end
	loc1, loc2 = with_dmz(loc1, loc2)
	return _GetFieldGroupCount(p, loc1, loc2)
end

local _IsExistingMatchingCard = Duel.IsExistingMatchingCard
function Duel.IsExistingMatchingCard(f, p, loc1, loc2, ct, ex, ...)
	if current_trial() then
		return call_scoped(push_nested, pop_nested, _IsExistingMatchingCard, f, p, loc1, loc2, ct, ex, ...)
	end
	local wrapped
	f, loc1, loc2, wrapped = apply_extra_bridge(f, loc1, loc2, ...)
	if wrapped then
		return _IsExistingMatchingCard(f, p, loc1, loc2, ct, ex)
	end
	return _IsExistingMatchingCard(f, p, loc1, loc2, ct, ex, ...)
end

local _SelectMatchingCard = Duel.SelectMatchingCard
function Duel.SelectMatchingCard(sp, f, p, loc1, loc2, min, max, ex, ...)
	if current_trial() then
		return call_scoped(push_nested, pop_nested, _SelectMatchingCard, sp, f, p, loc1, loc2, min, max, ex, ...)
	end
	local wrapped
	f, loc1, loc2, wrapped = apply_extra_bridge(f, loc1, loc2, ...)
	if wrapped then
		return _SelectMatchingCard(sp, f, p, loc1, loc2, min, max, ex)
	end
	return _SelectMatchingCard(sp, f, p, loc1, loc2, min, max, ex, ...)
end

if Duel.GetFirstMatchingCard then
	local _GetFirstMatchingCard = Duel.GetFirstMatchingCard
	function Duel.GetFirstMatchingCard(f, p, loc1, loc2, ex, ...)
		if current_trial() then
			return call_scoped(push_nested, pop_nested, _GetFirstMatchingCard, f, p, loc1, loc2, ex, ...)
		end
		local wrapped
		f, loc1, loc2, wrapped = apply_extra_bridge(f, loc1, loc2, ...)
		if wrapped then
			return _GetFirstMatchingCard(f, p, loc1, loc2, ex)
		end
		return _GetFirstMatchingCard(f, p, loc1, loc2, ex, ...)
	end
end
