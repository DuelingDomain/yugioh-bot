if not aux.MPAny then return end
-- Counter Gate: "when an opponent's monster declares a direct attack" holds only when the direct attack goes to you (FFA folds every opponent into the value 1).
s.condition=aux.MPAttackedAtMe(s.condition)
