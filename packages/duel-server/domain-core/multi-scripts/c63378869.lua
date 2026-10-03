if not aux.MPForEachDuelist then return end
-- After the destruction every duelist takes damage equal to the base ATK (R1, Q3, Tag partner included).
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	local bc=c:GetBattleTarget()
	if bc:IsRelateToBattle() and bc:IsControler(1-tp) and Duel.Destroy(bc,REASON_EFFECT)>0 then
		local dam=bc:GetBaseAttack()
		if dam>0 then
			aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,dam,REASON_EFFECT,true) end)
			Duel.RDComplete()
		end
	end
	if c:IsRelateToBattle() then
		aux.DelayedOperation(c,PHASE_BATTLE,id,e,tp,function(ag) Duel.Destroy(ag,REASON_EFFECT) end,nil,nil,1,aux.Stringid(id,3))
	end
end
