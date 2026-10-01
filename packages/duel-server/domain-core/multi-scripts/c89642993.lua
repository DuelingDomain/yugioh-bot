if not aux.MPForEachDuelist then return end
-- Choice 2: every duelist gains 1000 LP. Choice 1: every duelist draws 1 card in that Standby Phase (R1, Q3, Tag partner included).
-- The timing condition of the delayed draw (the opponent's turn) stays stock.
function s.efop(e,tp,eg,ep,ev,re,r,rp)
	if e:GetLabel()==0 then
		local e1=Effect.CreateEffect(e:GetHandler())
		e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
		e1:SetCode(EVENT_PHASE_START|PHASE_STANDBY)
		e1:SetCountLimit(1)
		e1:SetCondition(s.drcon)
		e1:SetOperation(s.drop)
		e1:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN)
		Duel.RegisterEffect(e1,tp)
	else
		aux.MPForEachDuelist(function(tp_i) Duel.Recover(tp_i,1000,REASON_EFFECT) end)
	end
end
function s.drop(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_CARD,0,id)
	aux.MPForEachDuelist(function(tp_i) Duel.Draw(tp_i,1,REASON_EFFECT) end)
end
