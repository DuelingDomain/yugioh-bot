if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- One opponent for the entire field stay: ATK/DEF, Special Summon burn and
-- destruction all refer to that same "your opponent" (owner 2026-10-23).
local mp_initial=s.initial_effect
function s.initial_effect(c)
	mp_initial(c)
	aux.MPRegisterLPOpponent(c)
end
function s.val(e,c)
	local handler=e:GetHandler()
	local _,lp=aux.MPCardLPOpponent(handler)
	return math.abs((Duel.MPGetLP(Duel.MPSeatOf(handler)) or 0)-lp)
end
function s.damcon(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	local seat=aux.MPCardLPOpponent(c)
	if c:GetOverlayCount()==0 or seat==nil then return false end
	local result=false
	-- IsSummonPlayer(1) matches every opponent even in a field window.
	-- Rebind the chosen real seat and test its own player value instead.
	aux.MPForEachDuelist(function(p,actual)
		if actual==seat then result=eg:IsExists(Card.IsSummonPlayer,1,nil,p) return true end
	end)
	return result
end
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local seat=aux.MPCardLPOpponent(e:GetHandler())
	if seat==nil or not Duel.MPBindSeat(seat) then return end
	Duel.Hint(HINT_CARD,0,id)
	Duel.Damage(1-tp,600,REASON_EFFECT)
end
local mp_destg,mp_desop=s.destg,s.desop
function s.destg(e,tp,eg,ep,ev,re,r,rp,chk)
	local seat=aux.MPCardLPOpponent(e:GetHandler())
	if chk==0 and Duel.MPBound() and Duel.MPSeat(1-tp)~=seat then return false end
	if seat==nil or not Duel.MPBindSeat(seat) then return false end
	Duel.MPWindow(0)
	local result=mp_destg(e,tp,eg,ep,ev,re,r,rp,chk)
	Duel.MPWindowEnd()
	return result
end
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	local seat=aux.MPCardLPOpponent(e:GetHandler())
	if seat==nil or not Duel.MPBindSeat(seat) then return end
	Duel.MPWindow(0)
	mp_desop(e,tp,eg,ep,ev,re,r,rp)
	Duel.MPWindowEnd()
end
