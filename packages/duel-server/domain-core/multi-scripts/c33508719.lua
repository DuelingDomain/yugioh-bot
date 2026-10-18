if not aux.MPForEachDuelist then return end
-- Owner 2026-10-18: Both players means every living duelist, including each Tag member.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,PLAYER_ALL,0)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,5)
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		g:Merge(Duel.GetFieldGroup(p,LOCATION_HAND,0))
	end)
	if #g>0 then Duel.SendtoGrave(g,REASON_DISCARD|REASON_EFFECT) end
	Duel.BreakEffect()
	aux.MPForEachDuelistFromTurn(function(p)
		Duel.Draw(p,5,REASON_EFFECT)
	end)
end
