if not aux.MPForEachController then return end
-- The equipped monster fixes the damage recipient. A phase event has no opponent bind.
function s.damtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	local tc=e:GetHandler():GetEquipTarget()
	if not tc then return end
	aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
		Duel.SetTargetPlayer(p)
		Duel.SetTargetParam(500)
		Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,1,p,500)
	end)
end
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local tc=e:GetHandler():GetEquipTarget()
	if tc then
		aux.MPForEachController(Group.FromCards(tc),function(g,seat,p) Duel.Damage(p,500,REASON_EFFECT) end)
	end
end
