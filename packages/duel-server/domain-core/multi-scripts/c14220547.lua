if not aux.MPTarget or not aux.MPOne then return end
-- Declare before the trigger resolves. The opponent-only Extra Deck read uses
-- that saved seat; the shared count and the own Extra Deck choice stay valid.
s.gytg=aux.MPTarget(s.gytg)
s.gyop=aux.MPOne(s.gyop)
