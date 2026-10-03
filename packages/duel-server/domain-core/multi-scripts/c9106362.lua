if not aux.MPAny then return end
-- Performapal Gongato: "when an opponent's monster declares a direct attack" holds only when the direct attack goes to you (FFA folds every opponent into the value 1). The monster effect (an attack at a monster, s.dmcon2) stays as it is.
s.dmcon1=aux.MPAttackedAtMe(s.dmcon1)
