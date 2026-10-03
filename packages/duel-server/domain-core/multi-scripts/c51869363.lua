if not aux.MPKey then return end
local mp_turn_check={}
local mp_turn
-- The global check registers its flag for the literal seat 0 and the holders read it with their own player value (a handler reads its own
-- key). The stock flag reaches only the first seat (core patch 0053: a global effect sees real seats). The wrapper of initial_effect makes the
-- operation of every global effect register that flag for every living duelist (the seat in FFA, the first seat of each team in Tag).
local mp_wrapped={}
local mp_initial=s.initial_effect
function s.initial_effect(c)
	local reg=Duel.RegisterEffect
	Duel.RegisterEffect=function(e,p,...)
		local op=e:GetOperation()
		if p==0 and op and not mp_wrapped[op] then
			local wrapped=function(...)
				local rf=Duel.RegisterFlagEffect
				Duel.RegisterFlagEffect=function(pl,...)
					if not (pl==0) then return rf(pl,...) end
					local args={...}
					local n=select('#',...)
					local first
					local seen={}
					aux.MPEachSeat(function(tp_i,seat_i)
						local k=aux.MPKeyOfSeat(seat_i)
						if not seen[k] then
							seen[k]=true
							local f=rf(seat_i,table.unpack(args,1,n))
							first=first or f
						end
					end)
					return first
				end
				local ok,err=pcall(op,...)
				Duel.RegisterFlagEffect=rf
				if not ok then error(err,0) end
			end
			mp_wrapped[wrapped]=true
			e:SetOperation(wrapped)
		end
		return reg(e,p,...)
	end
	local ok,err=pcall(mp_initial,c)
	Duel.RegisterEffect=reg
	if not ok then error(err,0) end
	-- A global Adjust reads the real turn seat, including a Debug start in Main.
	-- Keep this key separate from the stock destruction check's key s.
	aux.GlobalCheck(mp_turn_check,function()
		local ge=Effect.CreateEffect(c)
		ge:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
		ge:SetCode(EVENT_ADJUST)
		ge:SetOperation(function() mp_turn=Duel.GetTurnPlayer() end)
		Duel.RegisterEffect(ge,0)
	end)
end

-- The chosen branch is public. Inform every opponent without binding one.
-- Read the monster destruction flag and the current controller turn, including Tag.
function s.efftg(e,tp,eg,ep,ev,re,r,rp,chk)
	local op=mp_turn==Duel.MPSeatOf(e:GetHandler()) and 1 or 2
	local locations=LOCATION_MZONE|LOCATION_GRAVE|LOCATION_REMOVED
	if Duel.HasFlagEffect(tp,id) then locations=locations|LOCATION_DECK end
	if chk==0 then
		if op==1 then
			return Duel.GetFieldGroupCount(tp,LOCATION_DECK,0)>1
				and Duel.IsExistingMatchingCard(Card.IsRace,tp,LOCATION_DECK,0,1,nil,RACE_THUNDER|RACE_ROCK)
		end
		return Duel.IsExistingMatchingCard(s.thfilter,tp,locations,0,1,nil)
	end
	e:SetLabel(op)
	aux.MPEachOpponent(function()
		Duel.Hint(HINT_OPSELECTED,1-tp,aux.Stringid(id,op))
	end)()
	if op==1 then
		e:SetCategory(CATEGORY_DESTROY)
		Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,nil,1,PLAYER_EITHER,LOCATION_ONFIELD)
	else
		e:SetCategory(CATEGORY_TOHAND|CATEGORY_SEARCH)
		Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,locations)
	end
end
local mp_effop=s.effop
function s.effop(e,tp,...)
	if e:GetLabel()==1 then return mp_effop(e,tp,...) end
	local locations=LOCATION_MZONE|LOCATION_GRAVE|LOCATION_REMOVED
	if Duel.HasFlagEffect(tp,id) then locations=locations|LOCATION_DECK end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
	local hc=Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.thfilter),tp,locations,0,1,1,nil):GetFirst()
	if hc then
		if not hc:IsLocation(LOCATION_DECK) then Duel.HintSelection(hc) end
		Duel.SendtoHand(hc,nil,REASON_EFFECT)
		if hc:IsPreviousLocation(LOCATION_DECK) then Duel.ConfirmCards(1-tp,hc) end
	end
end
