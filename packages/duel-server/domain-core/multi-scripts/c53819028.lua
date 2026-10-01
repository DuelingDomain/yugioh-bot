if not aux.MPAny then return end
-- Predaplant Sarraceniant: "when an opponent's monster declares a direct attack" holds only when the direct attack goes to you (FFA folds every opponent into the value 1). The battle effects stay as they are.
s.spcon=aux.MPAttackedAtMe(s.spcon)
