if not aux.MPForEachDuelist then return end
-- Rebirth of the Seventh Emperors (script fix, R1 each player, R-COMMON-EACH-PLAYER): "During the End Phase of the turn you activated this card,
-- each player takes 300 damage for each card in their hand". The stock End Phase operation (registered with Duel.RegisterEffect, so it has no
-- bound opponent) damages tp for the cards of its hand and then 1-tp for the cards of ITS hand. In FFA the Lua value 1-tp is ONE opponent and
-- the count of its hand is the sum of the hands of EVERY opponent: one opponent took the damage for all the hands and the other opponents took
-- nothing. In Tag the own team took damage only for the hand of the seat that activated the card. Each living duelist (the Tag partner too) now
-- takes 300 for each card in its OWN hand (aux.MPForEachDuelist binds the scope to that duelist); in Tag the two partners add up on the team LP.
-- Two seats: the stock script.
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_CARD,0,id)
	aux.MPForEachDuelist(function(p,seat)
		Duel.Damage(p,Duel.GetFieldGroupCount(p,LOCATION_HAND,0)*300,REASON_EFFECT,true)
	end)
	Duel.RDComplete()
end
