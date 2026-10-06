-- Giant Ballpark: battle damage to any living player meets the condition.
if not aux.MPAnyDuelist then return end
function s.con(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAnyDuelist(function(tp_i)
		return Duel.GetBattleDamage(tp_i)>0
	end)
end
