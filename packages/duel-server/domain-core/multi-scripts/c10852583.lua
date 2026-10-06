-- A side-seat summon has no column toward which Yajiro can move.
if not aux.MPColumnGeometry then return end
local mp_mvcon,mp_mvop=s.mvcon,s.mvop
function s.mvcon(e,tp,eg,ep,ev,re,r,rp)
	if aux.MPColumnGeometry() and (#eg~=1 or Duel.MPSeatOf(eg:GetFirst())~=aux.MPColumnPeerSeat(Duel.MPSeat(tp))) then return false end
	return mp_mvcon(e,tp,eg,ep,ev,re,r,rp)
end
function s.mvop(e,tp,eg,ep,ev,re,r,rp)
	if aux.MPColumnGeometry() and (#eg~=1 or Duel.MPSeatOf(eg:GetFirst())~=aux.MPColumnPeerSeat(Duel.MPSeat(tp))) then return end
	return mp_mvop(e,tp,eg,ep,ev,re,r,rp)
end

-- R-FFA-THREE-COLUMNS: choose the column opponent before cards or zones.
if aux.MPColumnEffects then
	s.initial_effect=aux.MPColumnEffects(s.initial_effect,{s.mvop})
end
