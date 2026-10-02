# Hints do not require an opponent pick

Apply `hints-without-opponent-picks.patch` after core patches 0001 to 0061.
The patch is unnumbered. No core was installed.

At more than two duelists, `Duel.Hint` does not bind or mark the activation probe.
An opponent hint goes to every living opponent. The Tag partner gets no opponent hint.
The complete two-duelist path stays unchanged.

`hint-check.cpp` checks 12 cases on the native core: FFA3, FFA4, Tag, an existing bind,
an eliminated seat, own selection hints, and three stock two-duelist cases.
P61 gives 15 failed assertions. P61 with this patch gives zero failed assertions.
The patch also passes `git apply --check` and a C++ syntax check.

The Heritage overlay uses informational MESSAGE hints in each opponent window on P61.
Its card effects read the holder flag. Kaiho sums all seat flags, once per team in Tag.
The live Standard and Domain tests prove their draws with no opponent pick.
