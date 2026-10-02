if not aux.MPKey then return end
-- The global check registers its flag for the literal seat 0 and the holders read it with their own player value (a handler reads its own
-- key). The stock flag reaches only the first seat (core patch 0053: a global effect sees real seats). The wrapper of initial_effect makes the
-- operation of every global effect register that flag for every key and keep its label at the first remaining key.
local mp_wrapped={}
local mp_initial=s.initial_effect
function s.initial_effect(c)
	local reg=Duel.RegisterEffect
	Duel.RegisterEffect=function(e,p,...)
		local op=e:GetOperation()
		if p==0 and op and not mp_wrapped[op] then
			local wrapped=aux.MPGlobalFlagOperation(op)
			mp_wrapped[wrapped]=true
			e:SetOperation(wrapped)
		end
		return reg(e,p,...)
	end
	local ok,err=pcall(mp_initial,c)
	Duel.RegisterEffect=reg
	if not ok then error(err,0) end
end
