if not aux.MPAny then return end
-- Rikka Flurries (the release trigger): Trigger. The target asks the activator for the opponent; the operation runs in the window of that opponent.
s.reltg=aux.MPTarget(s.reltg)
s.relop=aux.MPOne(s.relop)
