if Duel.MPMode()~=1 or not aux.MPPick then return end
-- Owner 2026-10-18: declare the opponent whose next turn ends the global restriction.
s.condition=aux.MPPick(s.condition)
s.operation=aux.MPOne(s.operation)
