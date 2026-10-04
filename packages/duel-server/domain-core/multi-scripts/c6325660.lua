if not aux.MPPick or Duel.MPMode()~=2 then return end
-- Select one Tag opponent at activation for the opponent-hand effect.
s.target=aux.MPPick(s.target)
