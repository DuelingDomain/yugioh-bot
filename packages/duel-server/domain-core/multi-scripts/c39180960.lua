if not aux.MPForEachDuelist then return end
-- Every duelist discards 1 card from its hand (R1, Q3, Tag partner included). The stock target already says PLAYER_ALL.
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i)
		Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_DISCARD)
		g:Merge(Duel.SelectMatchingCard(tp_i,aux.TRUE,tp_i,LOCATION_HAND,0,1,1,nil))
	end)
	Duel.SendtoGrave(g,REASON_DISCARD|REASON_EFFECT)
end
