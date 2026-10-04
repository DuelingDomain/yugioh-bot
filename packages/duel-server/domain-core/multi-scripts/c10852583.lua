-- A side-seat summon has no column toward which Yajiro can move.
if not aux.MPGeometryShared then return end
local mp_mvcon,mp_mvop=s.mvcon,s.mvop
function s.mvcon(e,tp,eg,ep,ev,re,r,rp)
	if aux.MPGeometryShared() and (#eg~=1 or not eg:GetFirst():IsAcross(tp)) then return false end
	return mp_mvcon(e,tp,eg,ep,ev,re,r,rp)
end
function s.mvop(e,tp,eg,ep,ev,re,r,rp)
	if aux.MPGeometryShared() and (#eg~=1 or not eg:GetFirst():IsAcross(tp)) then return end
	return mp_mvop(e,tp,eg,ep,ev,re,r,rp)
end
