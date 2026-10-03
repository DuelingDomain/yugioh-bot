if not aux.MPAny then return end
-- Spirit's Invitation (the to-hand trigger): the target returns true at chk==0, so MPPick makes the trigger ask. Trigger. The target asks the activator for the opponent; the operation runs in the window of that opponent.
s.target=aux.MPTarget(s.target)
s.operation=aux.MPOne(s.operation)
