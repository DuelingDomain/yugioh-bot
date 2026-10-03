if not aux.MPTarget or Duel.MPMode()~=1 then return end
-- Pick one FFA opponent before selecting a monster from that opponent's field.
s.target=aux.MPTarget(s.target)
