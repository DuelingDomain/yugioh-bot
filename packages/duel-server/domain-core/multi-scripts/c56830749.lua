if not aux.MPAny then return end
-- Share the Pain: the cost reads the other side (a Tribute check), so the cost and the target both ask for the pick. Chain-link card. The target asks the activator for the opponent (FFA and Tag); the operation runs in the window of that opponent.
s.cost=aux.MPTarget(s.cost)
s.target=aux.MPTarget(s.target)
s.activate=aux.MPOne(s.activate)
