if not aux.MPAny then return end
-- Flashbang: "when an opponent's monster inflicts battle damage to you with a direct attack" holds only when the direct attack goes to you (FFA folds every opponent into the value 1).
s.condition=aux.MPAttackedAtMe(s.condition)
