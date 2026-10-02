if not aux.MPForEachDuelist then return end
-- The battle damage is avoided and every duelist takes 1000 damage (R1, Q3, Tag partner included).
function s.dmop(e,tp,eg,ep,ev,re,r,rp)
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetType(EFFECT_TYPE_FIELD)
	e1:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)
	e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
	e1:SetTargetRange(1,0)
	e1:SetReset(RESET_PHASE|PHASE_DAMAGE)
	Duel.RegisterEffect(e1,tp)
	aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,1000,REASON_EFFECT,true) end)
	Duel.RDComplete()
end
