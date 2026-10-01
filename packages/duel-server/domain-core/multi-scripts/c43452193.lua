if not aux.MPAny then return end
-- Mirror Gate (script fix, Q7 and Q10 of 2026-10-01): the stock condition never checks the controller of the attacked monster.
-- At 3 or 4 seats an attacker could pick the monster of a third duelist, and Duel.SwapControl(a,at) would swap with a monster of a duelist who does not own this card.
-- The attacked monster must belong to the activating duelist (at:IsControler(tp)); the swap stays between the attacker and that monster.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	local at=Duel.GetAttackTarget()
	return Duel.IsTurnPlayer(1-tp) and at and at:IsFaceup() and at:IsControler(tp) and at:IsSetCard(SET_ELEMENTAL_HERO)
end
