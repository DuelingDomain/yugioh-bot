if not aux.MPAny then return end
-- Ancient Warriors - Rebellious Lu Bu (compare card): both conditions ask if any one opponent passes the compare.
-- The destroy target asks the activator for the opponent (FFA and Tag) and picks a monster of that opponent.
s.sscon=aux.MPAny(s.sscon)
s.descon=aux.MPAny(s.descon)
s.destg=aux.MPTarget(s.destg)
