if not aux.MPForEachController then return end
-- Bind the current equip target, also for a later Standby Phase with no event controller.
function s.damtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	local tc=e:GetHandler():GetEquipTarget()
	if tc then
		aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
			Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,p,400)
		end)
	end
end
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local tc=e:GetHandler():GetEquipTarget()
	if tc then
		aux.MPForEachController(Group.FromCards(tc),function(g,seat,p) Duel.Damage(p,400,REASON_EFFECT) end)
	end
end
