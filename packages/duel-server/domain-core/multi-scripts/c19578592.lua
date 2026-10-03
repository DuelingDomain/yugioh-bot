if not aux.MPForEachController or not Duel.MPTurnOwns then return end
-- Only the owning duelist's Standby Phase applies; the target fixes the damage recipient.
function s.damcon(e,tp,eg,ep,ev,re,r,rp)
	return e:GetHandler():GetEquipTarget() and Duel.MPTurnOwns(e:GetHandler())
end
local mp_damtg=s.damtg
function s.damtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return mp_damtg(e,tp,eg,ep,ev,re,r,rp,chk) end
	local tc=e:GetHandler():GetEquipTarget()
	if not tc then return end
	aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
		mp_damtg(e,tp,eg,ep,ev,re,r,rp,chk)
	end)
end
local mp_damop=s.damop
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local tc=e:GetHandler():GetEquipTarget()
	if not tc then return end
	aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
		mp_damop(e,tp,eg,ep,ev,re,r,rp)
	end)
end
