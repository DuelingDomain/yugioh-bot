-- stock: s[sump] in the summon limit. sump is a folded value (0, or 1 for any opponent), so the limit reads the slot of the real controller
-- seat of the Extra Deck monster that is summoned.
function s.sumlimit(e,c,sump,sumtype,sumpos,targetp,se)
	if not c:IsLocation(LOCATION_EXTRA) then return false end
	local seat=Duel.MPSeatOf(c)
	if seat<0 then return false end
	return s.mp_slot(s,seat)<=0
end
