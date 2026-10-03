-- Hand Destruction stays forbidden in FFA. In Tag, every duelist sends two cards and draws two.
if Duel.MPMode()~=2 then return end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(p)
		return #Duel.GetMatchingGroup(nil,p,LOCATION_HAND,0,e:GetHandler())>=2 and Duel.IsPlayerCanDraw(p,2)
	end) end
	Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,0,0)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,0,0)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	if not aux.MPAllDuelists(function(p) return Duel.GetFieldGroupCount(p,LOCATION_HAND,0)>=2 end) then return end
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		if #g>0 then Duel.ConfirmCards(p,g) end
		Duel.Hint(HINT_SELECTMSG,p,HINTMSG_TOGRAVE)
		g:Merge(Duel.SelectMatchingCard(p,nil,p,LOCATION_HAND,0,2,2,nil))
	end)
	if #g>0 and Duel.SendtoGrave(g,REASON_EFFECT)>0 then
		if not Duel.GetOperatedGroup():IsExists(Card.IsLocation,1,nil,LOCATION_GRAVE) then return end
		Duel.BreakEffect()
		aux.MPForEachDuelist(function(p) Duel.Draw(p,2,REASON_EFFECT) end)
	end
end
