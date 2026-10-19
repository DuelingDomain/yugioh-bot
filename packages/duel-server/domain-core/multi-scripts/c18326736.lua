if not Duel.MPActionSeat or not Duel.MPGeometrySeat then return end
-- A skip belongs to one duelist, including when that duelist has a Tag partner.
local mp_initial=s.initial_effect
function s.initial_effect(c)
	local register=Card.RegisterEffect
	Card.RegisterEffect=function(card,e,...)
		if card==c and e:GetOperation()==s.skipop then
			e:SetTarget(aux.MPTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
				if chk==0 then
					if Duel.MPBound() then return not Duel.IsPlayerAffectedByEffect(1-tp,EFFECT_SKIP_TURN) end
					return aux.MPAnyOpponent(tp,function(p)
						return not Duel.IsPlayerAffectedByEffect(p,EFFECT_SKIP_TURN)
					end)
				end
			end))
		end
		return register(card,e,...)
	end
	local ok,err=pcall(mp_initial,c)
	Card.RegisterEffect=register
	if not ok then error(err,0) end
end
function s.skipop(e,tp,eg,ep,ev,re,r,rp)
	local seat=Duel.MPGeometrySeat(1-tp)
	local skip=Effect.CreateEffect(e:GetHandler())
	skip:SetDescription(aux.Stringid(id,3))
	skip:SetType(EFFECT_TYPE_FIELD)
	skip:SetProperty(EFFECT_FLAG_PLAYER_TARGET|EFFECT_FLAG_CLIENT_HINT)
	skip:SetCode(EFFECT_SKIP_TURN)
	skip:SetTargetRange(1,0)
	skip:SetReset(RESET_PHASE|PHASE_END|RESET_SELF_TURN)
	Duel.RegisterEffect(skip,Duel.MPActionSeat(seat))
end
