if not aux.MPForEachDuelist then return end
-- Bubble Crash: a duelist with 6 or more cards on its field and in its hand sends cards to the GY until it has 5 (R1, Q3, Tag partner
-- included). The condition is true when ANY duelist has 6 or more. Every selection is made first, then all cards are sent together.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAnyDuelist(function(tp_i) return Duel.GetFieldGroupCount(tp_i,LOCATION_ONFIELD|LOCATION_HAND,0)>=6 end)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	local exc=c:IsRelateToEffect(e) and c or nil
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i)
		local ct=Duel.GetFieldGroupCount(tp_i,LOCATION_ONFIELD|LOCATION_HAND,0)
		if ct>=6 then
			Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_TOGRAVE)
			g:Merge(Duel.SelectMatchingCard(tp_i,nil,tp_i,LOCATION_ONFIELD|LOCATION_HAND,0,ct-5,ct-5,exc))
		end
	end)
	Duel.SendtoGrave(g,REASON_RULE)
end
