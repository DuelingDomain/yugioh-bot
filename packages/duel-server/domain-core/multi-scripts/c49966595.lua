if not aux.MPAny then return end
-- Graydle Parasite: "when an opponent's monster declares a direct attack" holds only when the direct attack goes to you (FFA folds every opponent into the value 1). The second effect (a "Graydle" monster of yours attacks, s.spcon2) is your own attack and stays as it is.
s.spcon1=aux.MPAttackedAtMe(s.spcon1)
