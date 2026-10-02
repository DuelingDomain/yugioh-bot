if not aux.MPForEachController then return end
-- The card banished from the opponent's Deck keeps the real seat of the picked pair.
function s.thop(e,tp,eg,ep,ev,re,r,rp)
	local g=e:GetLabelObject()
	local own,opponent
	for tc in aux.Next(g) do
		if tc:IsControler(tp) then own=tc else opponent=tc end
	end
	g:DeleteGroup()
	if not own or not opponent then return end
	aux.MPForEachController(Group.FromCards(opponent),function(cards,seat,p)
		Duel.SendtoHand(own,p,REASON_EFFECT)
	end)
	Duel.SendtoHand(opponent,tp,REASON_EFFECT)
end
