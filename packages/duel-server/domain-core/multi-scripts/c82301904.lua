-- Chaos Emperor Dragon: all Tag hands are part of the global send. Keep the FFA ban.
if Duel.MPMode()~=2 then return end
local function mp_all_cards()
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		g:Merge(Duel.GetFieldGroup(p,LOCATION_HAND|LOCATION_ONFIELD,0))
	end)
	return g
end
local mp_sgtg=s.sgtg
function s.sgtg(e,tp,eg,ep,ev,re,r,rp,chk)
	local result=mp_sgtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk~=0 then
		local g=mp_all_cards()
		Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,#g,0,0)
	end
	return result
end
function s.sgop(e,tp,eg,ep,ev,re,r,rp)
	Duel.SendtoGrave(mp_all_cards(),REASON_EFFECT)
	local og=Duel.GetOperatedGroup()
	local ct=og:FilterCount(s.sgfilter,nil,1-tp)
	if ct>0 then
		Duel.BreakEffect()
		Duel.Damage(1-tp,ct*300,REASON_EFFECT)
	end
end
