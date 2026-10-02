-- Sky Scourge Norleras: collect all hands before one simultaneous send, then only the activator draws.
local function mp_all_cards()
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		g:Merge(Duel.GetFieldGroup(p,LOCATION_HAND|LOCATION_ONFIELD,0))
	end)
	return g
end
function s.sgtg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
	local g=mp_all_cards()
	Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,#g,0,0)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,0,0,tp,1)
end
function s.sgop(e,tp,eg,ep,ev,re,r,rp)
	Duel.SendtoGrave(mp_all_cards(),REASON_EFFECT)
	Duel.Draw(tp,1,REASON_EFFECT)
end
