if not aux.MPAny then return end
-- The Eye of Truth (script fix, misc-table): the stock effect gives 1000 LP to "1-tp" in the Standby Phase of an opponent that has a Spell in its hand.
-- At 3 or 4 seats the value 1 is any opponent, so the controller was asked for a pick and the picked seat gained the LP.
-- Rule: only the duelist whose Standby Phase it is, and that has a Spell in its own hand, gains the 1000 LP. No pick.
-- Duel.MPTurnOwns(c) is the seat compare (the turn player owns c) and it binds that owner. The Spell in the hand is the card that is passed.
function s.mpturnspell(tp)
	local g=Duel.GetMatchingGroup(Card.IsSpell,tp,0,LOCATION_HAND,nil)
	for tc in aux.Next(g) do
		if Duel.MPTurnOwns(tc) then return tc end
	end
	return nil
end
function s.reccon(e,tp,eg,ep,ev,re,r,rp)
	return s.mpturnspell(tp)~=nil
end
function s.rectg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	local tc=s.mpturnspell(tp)
	-- the card keeps its owner when it leaves the hand, so the same bind can be made again when the effect resolves
	e:SetLabelObject(tc)
	Duel.SetTargetPlayer(1-tp)
	Duel.SetTargetParam(1000)
	Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,1-tp,1000)
end
function s.recop(e,tp,eg,ep,ev,re,r,rp)
	if not e:GetHandler():IsRelateToEffect(e) then return end
	local tc=e:GetLabelObject()
	if not tc or not Duel.MPTurnOwns(tc) then return end
	local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
	Duel.Recover(p,d,REASON_EFFECT)
end
