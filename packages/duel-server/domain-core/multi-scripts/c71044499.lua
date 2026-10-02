-- Nobleman of Crossout: every living duelist banishes all copies and reveals its remaining Deck.
local function mp_all_decks(filter,...)
	local args={...}
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		g:Merge(Duel.GetMatchingGroup(filter,p,LOCATION_DECK,0,nil,table.unpack(args)))
	end)
	return g
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if tc and tc:IsFacedown() and tc:IsRelateToEffect(e) then
		if Duel.Destroy(tc,REASON_EFFECT,LOCATION_REMOVED)~=0 and tc:IsType(TYPE_FLIP) then
			Duel.Remove(mp_all_decks(Card.IsCode,tc:GetCode()),POS_FACEUP,REASON_EFFECT)
			local decks=mp_all_decks(nil)
			aux.MPForEachDuelist(function(p)
				Duel.ConfirmCards(p,decks)
				Duel.ShuffleDeck(p)
			end)
		end
	end
end
