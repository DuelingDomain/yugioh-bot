if not aux.MPAny then return end
-- Finger Game: "each player" is the owner exception to R-COMMON-EACH-PLAYER. The activator picks ONE opponent when the card is
-- activated, and only the two of them play (2 Decks, numbers 0 to 4), as in 1v1. The other duelists are not affected.
-- FFA: the operation runs in the window of the picked opponent. Tag: one duelist of the other team is bound.
s.target=aux.MPTarget(s.target)
s.activate=aux.MPOne(s.activate)
