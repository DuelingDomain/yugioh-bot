if not aux.MPAny then return end
-- Ghostrick Lantern: "when an opponent's monster declares a direct attack" holds only when the direct attack goes to you (FFA folds every opponent into the value 1). The second effect (your "Ghostrick" is targeted for an attack, s.spcon2) stays as it is.
s.spcon1=aux.MPAttackedAtMe(s.spcon1)
