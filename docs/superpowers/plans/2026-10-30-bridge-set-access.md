# Set access and alternative bridge paths

**Goal:** Discover grounded Set-based engine access, including Toy setup for Ashtra, and give existing pair judges several practical alternatives without increasing calls.

**Design:** Ground Set capabilities against the printed recipient, origin, exclusions and delayed activation clauses. Named/archetype and specific Spell/Trap subtype filters qualify; any-card/any-Trap tools alone do not. Direct target-engine Set paths are physical access, including hand/GY origins. A checked Set into a resource plus a target's printed reveal-and-return hand Summon is a separate complete setup path. Retain up to four distinct reasons, prioritizing practical physical access and different outlets over redundant mentions. Existing pair judging sees these alternative reasons in one request per framing; presentation captions are derived after review and excluded from judge and subscriber query identities.

**Constraints:** Integration tests only. Haiku only. Twelve new directed-pair reviews maximum; reuse current evidence verdicts. No web component changes, no live DB writes, preserve pre-existing edits. Explicit-path commits, no attribution lines. Remove build output.

- [x] Capture pre-change Ashtra/Argostars incoming and outgoing candidates on pinned data.
- [x] Add failing catalog integration cases for direct narrow Set, Toy/Ashtra resource setup, exclusions, same-turn permissions, and alternative paths.
- [x] Implement printed Set grounding, complete setup validation, and practical alternative reason selection.
- [x] Add review alternative path types/schema and host/web response validation; verify cached reviews are reused and budget unchanged.
- [x] Add golden labels and API documentation, and report exact newly discovered pairs/cards in both formats.
- [x] Run focused shared, host, web and golden integrations, compile/typecheck relevant packages and review the diff. Commit explicit paths and remove generated output after the final run.

Verification and the exhaustive pair/card inventory are recorded in `docs/performance/bridge-set-access-and-alternatives.md`.
