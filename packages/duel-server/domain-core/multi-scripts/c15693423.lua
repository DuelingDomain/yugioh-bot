if not aux.MPAny then return end
-- Evenly Matched (compare card and chooser card): FFA compares with ONE opponent (the activator picks).
-- Tag compares the joined opposing field and the picked duelist chooses (decision Q2 and Q5, 2026-10-01).
-- The target at chk==0 asks for the pick through MPAny; the other steps bind and run in window ONE.
local base_target=s.target
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		return aux.MPAny(function() return base_target(e,tp,eg,ep,ev,re,r,rp,chk) end)()
	end
	return aux.MPOne(base_target)(e,tp,eg,ep,ev,re,r,rp,chk)
end
s.activate=aux.MPOne(s.activate)
s.handcon=aux.MPAny(s.handcon)
