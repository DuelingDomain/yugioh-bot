if not aux.MPKey then return end
-- Hama: every copy reads the battle damage of its opponents, not one flag of the first holder.
-- The global check gets real seats. Its table has one key per seat in FFA and one per team in Tag.
s.mp_battle_damage={}
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	s.mp_battle_damage[aux.MPKey(ep)]=true
end
function s.clear(e,tp,eg,ep,ev,re,r,rp)
	s.mp_battle_damage={}
end
function s.damcon(e,tp,eg,ep,ev,re,r,rp)
	if not Duel.IsTurnPlayer(tp) then return false end
	local own=aux.MPKey(tp)
	for key,damaged in pairs(s.mp_battle_damage) do
		if key~=own and damaged then return false end
	end
	return true
end
