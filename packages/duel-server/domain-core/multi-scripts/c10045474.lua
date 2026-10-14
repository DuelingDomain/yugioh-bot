-- Lasting column negation uses the fixed living facing seat.
if not aux.MPColumnGeometry then return end
local mp_distg=s.distg
function s.distg(e,c)
	local tp=e:GetHandlerPlayer()
	if aux.MPColumnGeometry() then
		local own,seat=aux.MPGeometrySeat(tp),Duel.MPSeatOf(c)
		if seat~=own and seat~=aux.MPColumnPeerSeat(own) then return false end
	end
	return mp_distg(e,c)
end
s.disop=aux.MPColumnChainFilter(s.disop)
