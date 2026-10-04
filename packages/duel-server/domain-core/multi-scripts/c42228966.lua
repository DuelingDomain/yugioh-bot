if not aux.MPKey then return end
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
end

-- Read the global battle flag of the holder, including Tag team 1.
function s.setcon(e,tp)
	return Duel.IsPhase(PHASE_MAIN2) and Duel.GetFlagEffect(tp,id)==0
end
function s.tgcon(e,tp)
	return Duel.GetFlagEffect(tp,id)>0
end

-- The turn player sends cards from its own Deck, including in a Tag partner turn.
function s.tgtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	aux.MPForEachDuelistFromTurn(function(tp_i)
		Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,tp_i,5)
		return true
	end)
end
function s.tgop(e,tp,eg,ep,ev,re,r,rp)
	if not e:GetHandler():IsRelateToEffect(e) then return end
	aux.MPForEachDuelistFromTurn(function(tp_i)
		Duel.DiscardDeck(tp_i,5,REASON_EFFECT)
		return true
	end)
end
