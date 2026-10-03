if not aux.MPAny then return end
-- Brain Jacker (script fix, misc-table): the stock effect gives 500 LP to "1-tp" in every opponent Standby Phase.
-- At 3 or 4 seats that value is any opponent, so the controller was asked for a pick and the picked seat gained the LP.
-- Rule (owner, 2026-10-01): only the OWNER of the stolen monster gains the 500 LP, and only in its own Standby Phase. Same fix as Snatch Steal.
-- The event is bound to that owner: no pick. Duel.MPTurnOwns(c) is the seat compare (the turn player owns c) and it binds the owner.
function s.reccon(e,tp,eg,ep,ev,re,r,rp)
	local tc=e:GetHandler():GetEquipTarget()
	return tc~=nil and Duel.MPTurnOwns(tc)
end
function s.rectg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	local tc=e:GetHandler():GetEquipTarget()
	if tc then Duel.MPTurnOwns(tc) end
	Duel.SetTargetPlayer(1-tp)
	Duel.SetTargetParam(500)
	Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,1-tp,500)
end
function s.recop(e,tp,eg,ep,ev,re,r,rp)
	if not e:GetHandler():IsRelateToEffect(e) then return end
	local tc=e:GetHandler():GetEquipTarget()
	if tc then Duel.MPTurnOwns(tc) end
	local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
	Duel.Recover(p,d,REASON_EFFECT)
end
