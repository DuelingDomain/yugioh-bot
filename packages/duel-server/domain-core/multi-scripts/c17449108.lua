-- Nobleman of Extermination: every living duelist reveals its Deck and banishes all copies.
local function mp_all_decks(filter,...)
	local args={...}
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		g:Merge(Duel.GetMatchingGroup(filter,p,LOCATION_DECK,0,nil,table.unpack(args)))
	end)
	return g
end
local mp_target=s.target
function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	local result=mp_target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chk~=0 and not chkc then
		Duel.SetPossibleOperationInfo(0,CATEGORY_REMOVE,nil,1,0,0)
	end
	return result
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if tc:IsFacedown() and tc:IsRelateToEffect(e) and Duel.Destroy(tc,REASON_EFFECT,LOCATION_REMOVED)>0 and tc:IsTrap() then
		local code=tc:GetCode()
		local decks=mp_all_decks(nil)
		aux.MPForEachDuelist(function(p)
			Duel.ConfirmCards(p,decks)
			Duel.ShuffleDeck(p)
		end)
		local g=mp_all_decks(Card.IsCode,code)
		if #g>0 then Duel.Remove(g,POS_FACEUP,REASON_EFFECT) end
	end
end
