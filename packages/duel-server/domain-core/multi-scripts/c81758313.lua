if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- Owner ruling 2026-10-23: choose the LP source when placing Main Phase counters.
-- The End Phase counter, destruction replacement and stat threshold stay stock.
local mp_initial=s.initial_effect
function s.initial_effect(c)
	local register=Card.RegisterEffect
	Card.RegisterEffect=function(card,e,...)
		if card==c and e:IsHasType(EFFECT_TYPE_IGNITION) then
			e:SetTarget(s.mptarget)
			e:SetOperation(s.mpoperation)
		end
		return register(card,e,...)
	end
	local ok,err=pcall(mp_initial,c)
	Card.RegisterEffect=register
	if not ok then error(err,0) end
end
function s.mptarget(e,tp,eg,ep,ev,re,r,rp,chk)
	local c=e:GetHandler()
	local own=Duel.GetLP(tp)
	if chk==0 then
		return aux.MPAnyOpponentLP(tp,function(lp)
			local count=math.abs(own-lp)//1000
			return count>0 and c:IsCanAddCounter(0x21d,count)
		end)
	end
	Duel.SetOperationInfo(0,CATEGORY_COUNTER,c,0,tp,0x21d)
end
function s.mpoperation(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not c:IsRelateToEffect(e) then return end
	local own=Duel.GetLP(tp)
	local seat,other=aux.MPSelectLPOpponent(tp,function(lp)
		local count=math.abs(own-lp)//1000
		return count>0 and c:IsCanAddCounter(0x21d,count)
	end)
	aux.MPLPOpponentHint(c,seat,RESET_CHAIN)
	local count=math.abs(Duel.GetLP(tp)-other)//1000
	if count>0 then c:AddCounter(0x21d,count) end
	aux.MPLPOpponentHint(c,nil)
end
