-- Steamed Sabersaurus: shared Standard/Domain, 1v1/multiplayer bug fix.
-- Upstream: ProjectIgnis/CardScripts official/c3743515.lua at
-- 37f270dc813a12d123707ae255f2bda7922999c4. An opponent's direct attack
-- has no target; swapping attacker/target made atkcon index nil.
-- GetBattleMonster(tp) selects our battling monster, including in FFA.
function s.atkcon(e,tp,eg,ep,ev,re,r,rp)
	local a=Duel.GetBattleMonster(tp)
	return a~=nil and a:IsFaceup() and a:IsRace(RACE_DINOSAUR) and a~=e:GetHandler()
end
function s.atktg(e,tp,eg,ep,ev,re,r,rp,chk)
	local a=Duel.GetBattleMonster(tp)
	if chk==0 then return a~=nil end
	if not a then return end
	Duel.SetTargetCard(a)
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,tp,0)
	Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,a,1,tp,2000)
end
