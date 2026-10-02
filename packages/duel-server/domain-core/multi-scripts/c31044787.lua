if not aux.MPAny then return end
-- Ferret Flames: the condition compares the total ATK of ONE opponent with your LP, so it uses MPAny. Chain-link card. The target asks the activator for the opponent (FFA and Tag); the operation runs in the window of that opponent.
s.condition=aux.MPAny(s.condition)
s.target=aux.MPTarget(s.target)
s.activate=aux.MPOne(s.activate)
