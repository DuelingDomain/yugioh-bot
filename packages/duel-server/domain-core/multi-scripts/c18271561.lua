if not aux.MPForEachDuelist then return end
-- Every duelist takes damage equal to half of the ATK of the destroyed monster (R1, Q3, Tag partner included).
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)
	if #g==0 then return end
	local dg=g:GetMinGroup(Card.GetAttack)
	if #dg>1 then
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
		dg=dg:Select(tp,1,1,nil)
	end
	local atk=dg:GetFirst():GetAttack()/2
	if Duel.Destroy(dg,REASON_EFFECT)>0 then
		aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,atk,REASON_EFFECT,true) end)
		Duel.RDComplete()
	end
end
