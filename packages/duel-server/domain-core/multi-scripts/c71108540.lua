if not aux.MPKey then return end
-- The global check registers its flag for the literal seat 0 (any monster destroyed by battle) and 1 (a Demise Lord destroyed by battle), and the
-- holders read it with their own player value (a handler reads its own key). The stock flag reaches only the first seat (core patch 0053: a
-- global effect sees real seats). The wrapper of initial_effect makes the operation of every global effect register that flag for every
-- living duelist (the seat in FFA, the first seat of each team in Tag). The two slots are two keys: slot 1 is registered under id+100 and
-- s.spop reads it (HasFlagEffect(1,id), a folded opponent read) with the own seat of the holder. One key for both gave the 3000 ATK and the
-- indestructible effect after ANY battle kill.
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
					if not ((pl==0 or pl==1)) then return rf(pl,...) end
					local args={...}
					local n=select('#',...)
					if pl==1 and args[1]==id then args[1]=id+100 end
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
local mp_spop=s.spop
function s.spop(e,tp,...)
	local hf=Duel.HasFlagEffect
	Duel.HasFlagEffect=function(pl,fid,...)
		if pl==1 and fid==id then return hf(tp,id+100,...) end
		return hf(pl,fid,...)
	end
	local ok,err=pcall(mp_spop,e,tp,...)
	Duel.HasFlagEffect=hf
	if not ok then error(err,0) end
end
