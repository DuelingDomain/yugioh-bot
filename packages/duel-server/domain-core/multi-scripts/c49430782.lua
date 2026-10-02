if not aux.MPKey then return end
-- The global check registers its flag for the literal seat 0 and the holders read it with their own player value (a handler reads its own
-- key). The stock flag reaches only the first seat (core patch 0053: a global effect sees real seats). The wrapper of initial_effect makes the
-- operation of every global effect register that flag for every key and keep its label at the first remaining key.
local mp_wrapped={}
local mp_initial=s.initial_effect
function s.initial_effect(c)
	local reg=Duel.RegisterEffect
	local card_register=Card.RegisterEffect
	Card.RegisterEffect=function(card,e,...)
		if card==c and e:GetRange()==LOCATION_SZONE and e:GetCategory()&CATEGORY_DRAW~=0 then
			e:SetCondition(function(e) return Duel.GetFlagEffect(e:GetHandlerPlayer(),id)>0 end)
		end
		return card_register(card,e,...)
	end
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
	Card.RegisterEffect=card_register
	if not ok then error(err,0) end
end

-- P61 treats HINT_OPSELECTED as a player action and asks for a bind. Send the same text as an
-- informational MESSAGE in each opponent window until the core hint patch is installed.
local function mp_hint(e,tp)
	aux.MPEachOpponent(function() Duel.Hint(HINT_MESSAGE,1-tp,e:GetDescription()) end)()
end
function s.drtg(e,tp,eg,ep,ev,re,r,rp,chk)
	local ct=Duel.GetFlagEffect(tp,id)
	if chk==0 then return ct>0 and Duel.IsPlayerCanDraw(tp,ct) end
	mp_hint(e,tp)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,ct)
end
function s.sumtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(s.sumfilter,tp,LOCATION_HAND,0,1,nil) end
	mp_hint(e,tp)
	Duel.SetOperationInfo(0,CATEGORY_SUMMON,nil,1,tp,LOCATION_HAND)
end

function s.drop(e,tp,eg,ep,ev,re,r,rp)
	Duel.Draw(tp,Duel.GetFlagEffect(tp,id),REASON_EFFECT)
end
