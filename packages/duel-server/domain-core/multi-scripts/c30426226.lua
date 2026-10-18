if not aux.MPAny then return end
if Duel.MPMode()~=1 or not aux.MPOne then return end
-- Owner 2026-10-18: Compare one opponent at a time. The chosen pair alone swaps its monsters.
local mp_target=s.target
local mp_check=aux.MPAny(mp_target)
local mp_target_one=aux.MPOne(mp_target)
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return mp_check(e,tp,eg,ep,ev,re,r,rp,chk) end
	return mp_target_one(e,tp,eg,ep,ev,re,r,rp,chk)
end
s.activate=aux.MPOne(s.activate)
