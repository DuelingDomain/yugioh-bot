if not aux.MPAny then return end
-- Dark Coffin: trigger with no target. The condition asks for the pick; the operation, which reads the hand and the monsters of the opponent, runs in window ONE.
s.descon=aux.MPPick(s.descon)
s.desop=aux.MPOne(s.desop)
