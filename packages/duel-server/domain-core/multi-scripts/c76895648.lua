if not aux.MPForEachDuelist then return end
-- Dangerous Machine Type-6: the die is rolled in the operation; results 2 (opponent discards), 4 (opponent draws) and 5 (destroy an
-- opponent monster) need an opponent. The owner declares one when the effect is put on the chain, BEFORE the die is rolled
-- (R-COMMON-OPP-PICK), so the target step requests the pick (aux.MPPick). Results 2 and 4 use that bound duelist.
-- In FFA, result 5 selects only from the declared opponent's monsters (R-FFA-OPP-ONE), never every opponent's field.
-- Tag keeps its stock joined opposing field for result 5; the chosen opponent's partner can supply the destroyed monster.
-- Results 1 and 3 (own discard, own draw) and the destruction of this card itself (6) do not read an opponent.
local stock_target=s.target
s.target=aux.MPPick(stock_target)
