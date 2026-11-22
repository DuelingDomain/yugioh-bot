if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Number C88: Gimmick Puppet Disaster Leo. Owner decision of 22 Nov 2026 (R-COMMON-EXODIA): in FFA its End Phase win needs EVERY living
-- opponent at 2000 LP or less. The stock condition runs once for each living opponent, so one opponent was enough.
-- The 1000 burn (Duel.SetTargetPlayer(1-tp)) keeps the normal choose-one-opponent rule. Tag keeps the stock team LP check.
function s.wincon(e,tp,eg,ep,ev,re,r,rp)
	if not (Duel.IsTurnPlayer(tp) and e:GetHandler():GetOverlayCount()==0) then return false end
	local found=false
	for _,other in ipairs(aux.MPOpponentLPs(tp)) do
		found=true
		if other.lp>2000 then return false end
	end
	return found
end
