if not aux.MPKey then return end
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	for seat=0,3 do
		local bc=Duel.GetBattleMonster(seat)
		if bc and bc:ListsCode(TOKEN_ADVENTURER) then
			Duel.RegisterFlagEffect(seat,id,RESET_PHASE|PHASE_BATTLE,0,1)
		end
	end
end
