if not aux.MPForEachDuelist then return end
-- The last part: after the search every duelist discards 1 card (R1, Q3, Tag partner included). The draw of "your opponent" stays stock.
function s.drop(e,tp,eg,ep,ev,re,r,rp)
	local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
	if Duel.Draw(p,d,REASON_EFFECT)>0 then
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
		local g=Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)
		if #g>0 then
			if Duel.SendtoHand(g,nil,REASON_EFFECT)>0 then
				Duel.ConfirmCards(1-tp,g)
				Duel.BreakEffect()
				aux.MPForEachDuelist(function(tp_i)
					Duel.ShuffleHand(tp_i)
					Duel.DiscardHand(tp_i,nil,1,1,REASON_EFFECT)
				end)
			end
		end
	end
end
