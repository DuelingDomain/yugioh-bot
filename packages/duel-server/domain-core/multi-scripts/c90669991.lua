if not aux.MPAny then return end
-- Pineapple Blast (compare card and chooser card): the condition asks if any one opponent controls more monsters.
-- The target asks the activator for the opponent; the operation runs in window ONE and that opponent chooses.
-- Tag: the joined opposing field is compared and the picked duelist chooses (decision Q2 and Q5).
s.condition=aux.MPAny(s.condition)
s.target=aux.MPTarget(s.target)
s.activate=aux.MPOne(s.activate)
