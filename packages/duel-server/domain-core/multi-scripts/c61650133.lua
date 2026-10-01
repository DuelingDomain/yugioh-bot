if not aux.MPAny then return end
-- Summoning Curse: "the current controller of that monster(s) banishes 1 card from their hand" for every controller, also at 3 or 4 seats.
-- Each controller is read from the summoned monster, so no "1-tp" is needed and no window is open.
function s.rmop(e,tp,eg,ep,ev,re,r,rp)
	local seen={}
	local g=Group.CreateGroup()
	for tc in eg:Iter() do
		if tc:IsOnField() then
			local p=tc:GetControler()
			if not seen[p] then
				seen[p]=true
				Duel.Hint(HINT_SELECTMSG,p,HINTMSG_REMOVE)
				g:Merge(Duel.SelectMatchingCard(p,Card.IsAbleToRemove,p,LOCATION_HAND,0,1,1,nil))
			end
		end
	end
	Duel.Remove(g,POS_FACEUP,REASON_EFFECT)
end
