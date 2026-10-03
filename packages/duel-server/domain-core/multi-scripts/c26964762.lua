if not aux.MPForEachDuelist then return end
-- Destiny HERO - Dark Angel: every living duelist chooses from its own Deck during the Standby Phase effect.
function s.decktg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_DECK,0,1,nil)
		and aux.MPAnyOpponent(tp,function(p) return Duel.GetFieldGroupCount(p,LOCATION_DECK,0)>0 end) end
end
function s.deckop(e,tp,eg,ep,ev,re,r,rp)
	aux.MPForEachDuelist(function(p)
		Duel.Hint(HINT_SELECTMSG,p,aux.Stringid(id,3))
		local tc=Duel.SelectMatchingCard(p,s.filter,p,LOCATION_DECK,0,1,1,nil):GetFirst()
		if tc then
			Duel.ShuffleDeck(p)
			Duel.MoveSequence(tc,0)
			Duel.ConfirmDecktop(p,1)
		end
	end)
end
