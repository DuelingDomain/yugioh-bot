if not aux.MPPick or Duel.MPMode()~=2 then return end
-- Select one Tag opponent at activation before the hand and Deck choices.
s.target=aux.MPPick(s.target)
