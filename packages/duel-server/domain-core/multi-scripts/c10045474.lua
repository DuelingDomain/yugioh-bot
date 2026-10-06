-- Lasting columns use only the controller and its current column peer.
if not aux.MPColumnGeometry then return end
local mp_distg=s.distg
function s.distg(e,c)
	local tp=e:GetHandlerPlayer()
	if aux.MPColumnGeometry() and not c:IsControler(tp) and Duel.MPSeatOf(c)~=aux.MPColumnPeerSeat(Duel.MPSeat(tp)) then return false end
	return mp_distg(e,c)
end
s.disop=aux.MPColumnChainFilter(s.disop)
