if not aux.MPAny then return end
-- Phantom of Yubel: the stock replacement operation says "1-tp", where tp is the duelist who activated the changed effect, so the
-- duelist that destroys a Yubel monster of its own (the cost of the change) is the other side: the controller of Phantom of Yubel.
-- At 3 or 4 seats "1-tp" is the opponent that the activator has bound, or the activator has to pick one (in Tag one duelist of the
-- opposing team). The controller of Phantom of Yubel is not that one. It is read here as a real seat (Duel.MPSeatOf of the card)
-- and bound as the other side in the replacement operation (Duel.MPBindSeat).
function s.chngop(e,tp,eg,ep,ev,re,r,rp)
	local g=Group.CreateGroup()
	Duel.ChangeTargetCard(ev,g)
	local seat=nil
	if Duel.MPMode and Duel.MPMode()~=0 and Duel.MPSeatOf and Duel.MPBindSeat then
		seat=Duel.MPSeatOf(e:GetHandler())
	end
	Duel.ChangeChainOperation(ev,function(e2,tp2,eg2,ep2,ev2,re2,r2,rp2)
		if seat and seat>=0 then Duel.MPBindSeat(seat) end
		Duel.Hint(HINT_SELECTMSG,1-tp2,HINTMSG_DESTROY)
		local dg=Duel.SelectMatchingCard(1-tp2,s.yubelfilter,1-tp2,LOCATION_HAND|LOCATION_MZONE|LOCATION_DECK,0,1,1,nil)
		if #dg>0 then
			Duel.Destroy(dg,REASON_EFFECT,LOCATION_GRAVE,1-tp2)
		end
	end)
end
