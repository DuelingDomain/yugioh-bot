if not aux.MPAny then return end
-- Snatch Steal (script fix, s2-duelstyle-swap-1): the stock effect gives 1000 LP to "1-tp" in every opponent Standby Phase.
-- At 3 or 4 seats that value is any opponent, so the controller was asked for a pick and the picked seat gained the LP.
-- Rule (owner, 2026-10-01): only the OWNER of the stolen monster gains the 1000 LP, and only in its own Standby Phase.
-- The event is bound to that owner: no pick. Duel.MPTurnOwns(c) is the seat compare (the turn player owns c) and it binds the owner.
-- If you take your own monster (or a partner's in Tag), you gain the LP and no opponent does (OD-SNATCH, #219).
function s.reccon(e,tp,eg,ep,ev,re,r,rp)
	local tc=e:GetHandler():GetEquipTarget()
	return tc~=nil and Duel.MPTurnOwns(tc)
end
function s.rectg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	local tc=e:GetHandler():GetEquipTarget()
	if tc then Duel.MPTurnOwns(tc) end
	-- Own (or partner) monster: MPTurnOwns binds nothing, so "1-tp" would fall to the next opponent. The owner's side gains the LP.
	local p=1-tp
	if tc and aux.MPKeyOfSeat(Duel.MPOwnerSeat(tc))==aux.MPKey(tp) then p=tp end
	Duel.SetTargetPlayer(p)
	Duel.SetTargetParam(1000)
	Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,p,1000)
end
function s.recop(e,tp,eg,ep,ev,re,r,rp)
	if not e:GetHandler():IsRelateToEffect(e) then return end
	local tc=e:GetHandler():GetEquipTarget()
	if tc then Duel.MPTurnOwns(tc) end
	local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
	Duel.Recover(p,d,REASON_EFFECT)
end
