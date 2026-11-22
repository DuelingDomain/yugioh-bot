# November 16 engine data CI review (PR #619)

The weekly bump changes card data and scripts only. Rules core, WASM, Lua and Emscripten pins stay unchanged.

## Multiplayer admission

All three scanner risks are temporarily forbidden at Tag, FFA3 and FFA4 tables, including Domain tables and tables with deck validation disabled. Ordinary 1v1 admission is unchanged.

- **54475145 — Heart of the Blue-Eyes:** the existing `R2_NO_CHANGE` review says the core keys its global Ankh flag by real seat in FFA and by team in Tag. That is not evidence that the complete new script has a live multiplayer proof. Its summon trigger filters the event group using `1-tp` and sends the entire matching group to the GY. Before admission, prove the flag and the summoned-monster group against multiple real opponents and Tag members. Apply the existing owner rule: choose one opponent; use only that opponent's summoned monsters. No flag implementation defect is claimed by this restriction.
- **100461101 — Arcana Force VIII - The Strength:** `coinop` saves folded `1-tp` before tossing. Heads selects opposing monsters; tails asks that opponent to choose another own monster and transfers it to that opponent. Both branches, including the Light Barrier choice, need an explicit opponent binding and live scenarios. The existing owner rule supplies the intended ruling: choose one opponent, including one opposing member in Tag.
- **100464005 — Finger Game — resolved (owner 2026-11-22):** the card is allowed in FFA3, FFA4 and Tag. The activating duelist picks ONE opponent (R-COMMON-OPP-PICK) and only those two duelists play, as in 1v1. This is an owner exception to R-COMMON-EACH-PLAYER. See ADR-0002.

Evidence citations are maintained in the multiplayer scenario catalog. These restrictions claim no new gameplay proof.

## CI failures

Native sanitizer checks themselves passed (86 checks). The golden gate stopped before running duels because its data-pin fingerprint belonged to the preceding bundle. Re-record with the repository's native driver, then check the recorded matrix against this candidate.

The bridge precision/recall evaluator passed. Shared, duel and effect-tagging tests instead assumed the previous bridge snapshot: ranking order, available engine pairs, grounded support membership, and the set of candidates needing cached reviews changed on regeneration. The new artifact indexes 13,986 identities rather than 13,954; it also consumes a newer profile/metadata snapshot. These differences are broader than the 29 newly added engine cards. Keep the regenerated artifacts and their integrity checks. Update exact catalog expectations and seed the intended review fixtures explicitly; preserve the formatter's GY-recovery case independently of whether discovery currently publishes Drytron/Ursarctic as distinct engines.

The first follow-up CI run also merged newer `main` bridge observations into its test checkout. That exposed two further stale assumptions: Azamina/Diabell → White Forest now has a measured co-play bonus, and the observed Ashtra core needs eleven missing copies in the owner-deck fixture. Integrate `main` locally to reproduce CI, include the observation prior in the score equation, and update the exact missing-copy expectation.
