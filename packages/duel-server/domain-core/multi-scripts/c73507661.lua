if not aux.MPForEachDuelist then return end
-- Every duelist takes 300 damage for each destroyed card (R1, Q3, Tag partner included).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local sg=Duel.GetMatchingGroup(s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,e:GetHandler())
	local ct=Duel.Destroy(sg,REASON_EFFECT)
	aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,ct*300,REASON_EFFECT,true) end)
	Duel.RDComplete()
end
