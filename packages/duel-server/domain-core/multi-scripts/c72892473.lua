-- Card Destruction stays forbidden in FFA. In Tag, every duelist discards and draws its own count.
if Duel.MPMode()~=2 then return end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		local total=0
		local ok=aux.MPAllDuelists(function(p)
			local ct=#Duel.GetMatchingGroup(nil,p,LOCATION_HAND,0,e:GetHandler())
			total=total+ct
			return ct==0 or Duel.IsPlayerCanDraw(p,ct)
		end)
		return ok and total>0
	end
	Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,0,0)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,0,0)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local g=Group.CreateGroup()
	local counts={}
	aux.MPForEachDuelist(function(p,seat)
		local hg=Duel.GetFieldGroup(p,LOCATION_HAND,0)
		counts[seat]=#hg
		g:Merge(hg)
	end)
	Duel.SendtoGrave(g,REASON_EFFECT|REASON_DISCARD)
	Duel.BreakEffect()
	aux.MPForEachDuelist(function(p,seat)
		Duel.Draw(p,counts[seat],REASON_EFFECT)
	end)
end
