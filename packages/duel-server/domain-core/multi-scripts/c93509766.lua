if not aux.MPKey then return end
-- The global check registers its flag for the literal seat 0 and the holders read it with their own player value (a handler reads its own
-- key). The stock flag reaches only the first seat (core patch 0053: a global effect sees real seats). The wrapper of initial_effect makes the
-- operation of every global effect register that flag for every living duelist (the seat in FFA, the first seat of each team in Tag).
local mp_wrapped={}
local mp_initial=s.initial_effect
function s.initial_effect(c)
	local sc=Effect.SetCondition
	Effect.SetCondition=function(e,fn)
		if e:GetRange()==LOCATION_HAND then
			return sc(e,function(e,tp)
				return Duel.IsMainPhase() and Duel.HasFlagEffect(tp,id,2)
			end)
		end
		return sc(e,fn)
	end
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
	Effect.SetCondition=sc
	Duel.RegisterEffect=reg
	if not ok then error(err,0) end
end
