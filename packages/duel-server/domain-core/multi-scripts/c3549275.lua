if not aux.MPTarget then return end
-- Dice Jar (script fix, late-cards): a duel-style card (ADR-0002 Q4): it acts on its owner and ONE picked opponent. The other opponents do nothing.
-- The stock operation rolls Duel.TossDice(tp,1,1): the core gives the 2nd die to the first living opponent clockwise, but the damage of the
-- winner is dealt to "1-tp", the opponent that was picked (or the first one that the core asks at that point). The two could be different
-- seats, so a duelist that did not roll lost the LP. The activator picks the opponent at activation (aux.MPTarget binds it, as for every
-- chooser card), and each of the two duelists rolls its own die: the owner, then the bound opponent (the value 1-tp). Tag: the die of the
-- opposing side is rolled for the bound opponent and the damage reaches the team LP.
s.target=aux.MPTarget(s.target)
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local d1=0
	local d2=0
	while d1==d2 do
		d1=Duel.TossDice(tp,1)
		d2=Duel.TossDice(1-tp,1)
	end
	if d1<d2 then
		if d2==6 then
			Duel.Damage(tp,6000,REASON_EFFECT)
		else
			Duel.Damage(tp,d2*500,REASON_EFFECT)
		end
	else
		if d1==6 then
			Duel.Damage(1-tp,6000,REASON_EFFECT)
		else
			Duel.Damage(1-tp,d1*500,REASON_EFFECT)
		end
	end
end
