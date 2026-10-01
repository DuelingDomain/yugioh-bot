if not aux.MPAny then return end
-- Gilasaurus (the Special Summon trigger): Trigger. The target asks the activator for the opponent; the operation runs in the window of that opponent.
s.target=aux.MPTarget(s.target)
s.operation=aux.MPOne(s.operation)
