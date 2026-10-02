-- Alba System Dogmatikalamity: send each living duelist's Extra Deck to the GY.
local function mp_all_extra()
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		g:Merge(Duel.GetFieldGroup(p,LOCATION_EXTRA,0))
	end)
	return g
end
function s.tgtg(e,tp,eg,ep,ev,re,r,rp,chk)
	local g=mp_all_extra()
	if chk==0 then return #g>0 end
	Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,#g,0,0)
end
function s.tgop(e,tp,eg,ep,ev,re,r,rp)
	local g=mp_all_extra()
	if #g>0 then Duel.SendtoGrave(g,REASON_EFFECT) end
end
