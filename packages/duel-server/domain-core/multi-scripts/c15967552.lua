-- Only the living across opponent has the second zone of this column.
if not aux.MPGeometryShared then return end
local mp_sptg,mp_spop=s.sptg,s.spop
function s.sptg(e,tp,eg,ep,ev,re,r,rp,chk,...)
	if aux.MPGeometryShared() then
		local across=Duel.MPAcrossSeat(Duel.MPSeat(0))
		if Duel.MPBound() and Duel.MPSeat(1-tp)~=across then return false end
		if not Duel.MPBindSeat(across) then return false end
	end
	return mp_sptg(e,tp,eg,ep,ev,re,r,rp,chk,...)
end
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	-- MPBindSeat ends with its callback. Bind again from the activation seat.
	-- This also works after the Trap leaves the field. Seat pairs do not move.
	if aux.MPGeometryShared() then
		local across=Duel.MPAcrossSeat(Duel.MPSeat(0))
		if Duel.MPBound() and Duel.MPSeat(1-tp)~=across then return end
		if not Duel.MPBindSeat(across) then return end
	end
	return mp_spop(e,tp,eg,ep,ev,re,r,rp)
end
