if not aux.MPKey then return end
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	if not Duel.IsDamageCalculated() then return end
	for seat=0,3 do
		local bc=Duel.GetBattleMonster(seat)
		if s.checkfilter(bc) then
			Duel.RegisterFlagEffect(seat,id,RESET_PHASE|PHASE_END,0,1)
		end
	end
end
