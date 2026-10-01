if not aux.MPAny then return end
-- Inferno Reckless Summon: the card text says "your opponent" (one), so this is one picked opponent (decision Q5), not each opponent. Chain-link card. The target asks the activator for the opponent (FFA and Tag); the operation runs in the window of that opponent.
s.target=aux.MPTarget(s.target)
s.activate=aux.MPOne(s.activate)
