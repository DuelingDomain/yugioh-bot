if not aux.MPAny then return end
-- F.A. Dead Heat: "when an opponent's monster declares a direct attack" holds only when the direct attack goes to you (FFA folds every opponent into the value 1).
s.spcon=aux.MPAttackedAtMe(s.spcon)
