-- Drillago: "your opponent" is the prospective defender, then the attacked seat.
-- No activation or opponent-pick prompt: this is a continuous direct-attack condition.
if not aux.MPDirectAttackCondition then return end
s.dircon=aux.MPDirectAttackCondition(s.dircon)
