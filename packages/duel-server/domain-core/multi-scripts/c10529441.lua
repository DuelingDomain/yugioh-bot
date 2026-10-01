if not aux.MPKey then return end
local function mp_seats()
	local seats={}
	aux.MPForEachDuelist(function(tp_i,seat_i) seats[#seats+1]=seat_i end)
	return seats
end
local mp_initial=s.initial_effect
function s.initial_effect(c)
	local reg=Duel.RegisterEffect
	Duel.RegisterEffect=function(e,p,...)
		local op=e:GetOperation()
		if p==0 and op then
			e:SetOperation(function(e2,tp,eg,ep,ev,re,r,rp)
				for _,seat in ipairs(mp_seats()) do
					if eg:IsExists(Card.IsSummonPlayer,1,nil,seat) then
						Duel.RegisterFlagEffect(seat,id,RESET_PHASE|PHASE_END,0,1)
					end
				end
			end)
		end
		return reg(e,p,...)
	end
	local ok,err=pcall(mp_initial,c)
	Duel.RegisterEffect=reg
	if not ok then error(err,0) end
end
