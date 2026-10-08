-- The current column peer has the second zone of this column.
if not aux.MPColumnGeometry then return end
local mp_sptg,mp_spop=s.sptg,s.spop
function s.sptg(e,tp,eg,ep,ev,re,r,rp,chk,...)
	if aux.MPGeometryShared() then
		local across=aux.MPColumnPeerSeat(aux.MPGeometrySeat())
		if Duel.MPBound() and aux.MPGeometrySeat(1-tp)~=across then return false end
		if not Duel.MPBindSeat(across) then return false end
	end
	return mp_sptg(e,tp,eg,ep,ev,re,r,rp,chk,...)
end
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	-- MPBindSeat ends with its callback. Bind again from the activation seat.
	-- This also works after the Trap leaves the field. Seat pairs do not move.
	if aux.MPGeometryShared() then
		local across=aux.MPColumnPeerSeat(aux.MPGeometrySeat())
		if Duel.MPBound() and aux.MPGeometrySeat(1-tp)~=across then return end
		if not Duel.MPBindSeat(across) then return end
	end
	return mp_spop(e,tp,eg,ep,ev,re,r,rp)
end

-- FFA3: declare the opponent before selecting the matching own zone.
local mp_column_sptg,mp_column_spop=s.sptg,s.spop
function s.sptg(e,tp,eg,ep,ev,re,r,rp,chk,...)
	if Duel.MPMode()==1 and not aux.MPGeometryShared() then
		if chk==0 then return aux.MPAny(mp_column_sptg)(e,tp,eg,ep,ev,re,r,rp,chk,...) end
		return aux.MPOne(mp_column_sptg)(e,tp,eg,ep,ev,re,r,rp,chk,...)
	end
	return mp_column_sptg(e,tp,eg,ep,ev,re,r,rp,chk,...)
end
function s.spop(...)
	if Duel.MPMode()==1 and not aux.MPGeometryShared() then return aux.MPOne(mp_column_spop)(...) end
	return mp_column_spop(...)
end

-- R-FFA-THREE-COLUMNS: choose the column opponent before cards or zones.
if aux.MPColumnEffects then
	s.initial_effect=aux.MPColumnEffects(s.initial_effect,{s.spop})
end
