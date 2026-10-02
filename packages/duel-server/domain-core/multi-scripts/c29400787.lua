if not aux.MPAny then return end
-- Ghostrick Parade: "when an opponent's monster declares a direct attack" holds only when the direct attack goes to you (FFA folds every opponent into the value 1).
s.thcon=aux.MPAttackedAtMe(s.thcon)
