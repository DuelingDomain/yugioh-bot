-- FFA4 column effects use only the controller and its living across seat.
if not aux.MPGeometryShared then return end
local mp_distg=s.distg
function s.distg(e,c)
	local tp=e:GetHandlerPlayer()
	if aux.MPGeometryShared() and not c:IsControler(tp) and not c:IsAcross(tp) then return false end
	return mp_distg(e,c)
end
s.disop=aux.MPGeometryChainFilter(s.disop)
