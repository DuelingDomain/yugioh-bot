if not aux.MPAny then return end
-- Weighbridge: the condition compares the monsters of ONE opponent with yours (MPAny). The triage did not list it as a compare card. Chain-link card. The target asks the activator for the opponent (FFA and Tag); the operation runs in the window of that opponent.
s.tgcon=aux.MPAny(s.tgcon)
s.tgtg=aux.MPTarget(s.tgtg)
s.tgop=aux.MPOne(s.tgop)
