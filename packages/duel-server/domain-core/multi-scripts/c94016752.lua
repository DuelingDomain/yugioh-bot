if not aux.MPAny then return end
-- Herald of the Abyss: Chain-link card. The target asks the activator for the opponent (FFA and Tag); the operation runs in the window of that opponent.
s.target=aux.MPTarget(s.target)
s.activate=aux.MPOne(s.activate)
