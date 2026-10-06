if not Duel.MPOwnerSeat or not Duel.MPChainSeat or not aux.MPKeyOfSeat then return end
-- Bystial Dis Pater (script fix, #217): the stock effect compares the owner of the shuffled card with "tp" and "1-tp".
-- At 3 or 4 seats every opponent reads as 1-tp, so a card of a third duelist counted as the deck of the opponent that activated
-- the monster effect, and the effect was negated. Rulebook v1.4 (Frequently Asked Cards, Bystial Dis Pater): your own deck, destroy;
-- the deck of the opponent who activated the monster effect, negate; otherwise nothing else happens.
-- The activator is the real seat of the chain link (Duel.MPChainSeat(ev)); owners are real seats (Duel.MPOwnerSeat). The side is the
-- seat in FFA and the team in Tag (aux.MPKeyOfSeat), so a Tag partner's deck is "your own".
local function mp_deck_class(tc,tp,ev)
	local owner=Duel.MPOwnerSeat(tc)
	if owner<0 then return 0 end
	local key=aux.MPKeyOfSeat(owner)
	if key==aux.MPKey(tp) then return 1 end
	local activator=Duel.MPChainSeat(ev)
	if activator>=0 and key==aux.MPKeyOfSeat(activator) then return 2 end
	return 0
end
function s.destg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chkc then return chkc:IsLocation(LOCATION_REMOVED) and chkc:IsAbleToDeck() end
	if chk==0 then return Duel.IsExistingTarget(Card.IsAbleToDeck,tp,LOCATION_REMOVED,LOCATION_REMOVED,1,nil) end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TODECK)
	local tc=Duel.SelectTarget(tp,Card.IsAbleToDeck,tp,LOCATION_REMOVED,LOCATION_REMOVED,1,1,nil):GetFirst()
	Duel.SetOperationInfo(0,CATEGORY_TODECK,tc,1,0,0)
	local rc=re:GetHandler()
	local class=mp_deck_class(tc,tp,ev)
	if class==1 and rc:IsDestructable() and rc:IsRelateToEffect(re) then
		Duel.SetOperationInfo(0,CATEGORY_DESTROY,eg,1,tp,0)
	elseif class==2 then
		Duel.SetOperationInfo(0,CATEGORY_DISABLE,eg,1,0,0)
	end
	Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,eg,1,tp,0)
	Duel.SetPossibleOperationInfo(0,CATEGORY_DISABLE,eg,1,0,0)
end
function s.desop(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if not (tc:IsRelateToEffect(e) and Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)>0 and tc:IsLocation(LOCATION_DECK|LOCATION_EXTRA)) then return end
	local class=mp_deck_class(tc,tp,ev)
	if class==1 and re:GetHandler():IsRelateToEffect(re) then
		Duel.BreakEffect()
		Duel.Destroy(eg,REASON_EFFECT)
	elseif class==2 then
		Duel.BreakEffect()
		Duel.NegateEffect(ev)
	end
end
