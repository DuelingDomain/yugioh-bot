-- Mischief of the Gnomes: include the Tag partner's existing hand.
function s.lvop(e,tp,eg,ep,ev,re,r,rp)
	-- The stock operation also registers one global effect for later cards added to hands.
	-- Gather all existing hands once; register that stock continuous effect only once.
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		g:Merge(Duel.GetMatchingGroup(Card.IsLevelAbove,p,LOCATION_HAND,0,nil,1))
	end)
	for c in aux.Next(g) do
		local e1=Effect.CreateEffect(e:GetHandler())
		e1:SetType(EFFECT_TYPE_SINGLE)
		e1:SetCode(EFFECT_UPDATE_LEVEL)
		e1:SetValue(-1)
		e1:SetReset(RESET_EVENT|(RESETS_STANDARD_PHASE_END&~RESET_TOFIELD))
		c:RegisterEffect(e1)
	end
	local e2=Effect.CreateEffect(e:GetHandler())
	e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
	e2:SetCode(EVENT_TO_HAND)
	e2:SetReset(RESET_PHASE|PHASE_END)
	e2:SetOperation(s.hlvop)
	Duel.RegisterEffect(e2,tp)
end
