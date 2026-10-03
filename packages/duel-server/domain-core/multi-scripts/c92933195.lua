if not aux.MPForEachDuelist then return end
-- Every duelist with 5 or more cards in hand discards down to 4 (R1, Q3, Tag partner included). The condition needs every duelist to have
-- 5 or more. The picks are made first, then the cards are sent together.
function s.handcon(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAllDuelists(function(tp_i) return Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0)>=5 end)
end
function s.handop(e,tp,eg,ep,ev,re,r,rp)
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i)
		local ht=Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0)
		if ht>=5 then
			Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_TOGRAVE)
			g:Merge(Duel.SelectMatchingCard(tp_i,aux.TRUE,tp_i,LOCATION_HAND,0,ht-4,ht-4,nil))
		end
	end)
	Duel.SendtoGrave(g,REASON_EFFECT)
end
