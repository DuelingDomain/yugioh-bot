if not aux.MPForEachDuelist then return end
-- Only the card controller's own End Phase counts; the Tag partner's turn does not count.
function s.damcon(e,tp,eg,ep,ev,re,r,rp)
	return Duel.MPTurnControls(e:GetHandler())
end
-- Every duelist takes 3000 damage (R1, Q3, Tag partner included).
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,3000,REASON_EFFECT,true) end)
	Duel.RDComplete()
end
