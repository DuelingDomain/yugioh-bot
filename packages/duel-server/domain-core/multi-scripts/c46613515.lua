if not aux.MPAny then return end
-- Clear Kuriboh: "when an opponent's monster declares a direct attack" holds only when the direct attack goes to you (FFA folds every opponent into the value 1).
s.drcon=aux.MPAttackedAtMe(s.drcon)
