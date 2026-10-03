if not aux.MPKey then return end
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	return s[0]~=nil and aux.MPKeyOfSeat(s[0])==aux.MPKeyOfSeat(Duel.MPSeatOf(e:GetHandler()))
		and #eg==1 and eg:GetFirst()==s[2] and eg:GetFirst():GetBattlePosition()==POS_FACEUP_ATTACK
end
