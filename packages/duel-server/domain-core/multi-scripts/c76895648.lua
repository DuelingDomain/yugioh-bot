if not aux.MPForEachDuelist then return end
-- Dangerous Machine Type-6: the die is rolled in the operation and four results act on "your opponent": 2 the hand (discard), 4 the Deck
-- (draw), 5 the monsters (destroy), 6 nothing. The hand and the draw are R-COMMON-OPP-PICK: the owner picks one opponent when the effect
-- is put on the chain (before the die is rolled), so the target step asks for the pick (aux.MPPick). The operation then reads the bound
-- opponent. A late pick inside the operation is not allowed (trap c). The destroy (result 5) is the field of "your opponent" and stays
-- stock: it chooses among the monsters of every opponent (R-COMMON-OPP-FIELD). Results 1 and 3 (own discard, own draw) and the
-- destroy of the card itself (6) do not read an opponent.
local stock_target=s.target
s.target=aux.MPPick(stock_target)
