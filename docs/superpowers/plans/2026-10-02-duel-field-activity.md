# Duel field turn and priority

**Goal:** Keep the turn player's zones marked in gold and the current prompt owner's zones marked in purple, including opponent response windows.

**Architecture:** Add optional public `prioritySeat` metadata to `DuelEngineView`. The engine projection publishes the pending prompt's seat to every viewer while retaining prompt privacy. A pure web helper derives activity; `DuelField` renders separate edges and tally labels. Local priority follows the room's answerable prompt reveal; both players' priority clears while actions are busy, paused or catching up. Private opponent prompts use one board animation wait, including finite CSS feedback and phase beats, capped at `promptCapMs` (8 seconds). CSS transitions and prompt entrances do not delay priority. A revealed event batch stays ready when priority changes actors without new events. Gold holds the previous turn owner until the new turn's first planned phase beat starts. Saved snapshots and replay frames clear priority because recorded decisions are not live requests.

**Design:** Reuse the field's gold (`#e4b64f`) and purple (`#9b7eff`), existing typography and fit system. Gold is steady with a faint tint. Purple is a slim breathing edge. Both can appear on one half. Labels read `Turn`, `Your move`, or `Opponent to act`; spectators see the player's name. No overlay over cards, no inactive-side dimming. Reduced motion disables the pulse.

**Constraints:** Preserve all Master Rule layouts, Domain support and the usable-card `.glow`. Frame the full player half, including both piles, with the shared Extra Monster Zone band left clear. Use solid edges, without dimming or dashed outlines.

Public opponent priority intentionally reveals a live response window in untimed duels; timed duels already expose it through `clock.activeSeat`, and Master Duel has the same tell.

- [x] Add failing projection tests for both players, spectators, no pending prompt and finished duels.
- [x] Add failing derivation and field rendering tests for split/shared ownership, legacy snapshots, reversed viewing seat, no actor and animation gates.
- [x] Publish optional priority metadata; clear it on frozen views and replay frames.
- [x] Implement derivation, field edges and tally labels; preserve all Master Rule layouts and Domain support.
- [x] Add five Board states lab scenes with real projected prompt ownership and a usable-card glow.
- [x] Run web tests, shared tests, duel-server tests with the supplied engine data path, and root typecheck. Re-run isolated known flaky tests if needed.
- [x] Review the final diff and record verification results.

Initial verification (2026-10-02):
- Web full run: 210 files, 2,408 tests; 2,404 passed and four known DB route flakes. Affected files passed alone: decks-draft-route 31/31, drafts-deck-pool-route 10/10, tournaments-slug-route 8/8. New derivation/rendering coverage passed 49/49.
- Shared: 41 files, 377/377 tests passed.
- Duel server with the supplied DUEL_DATA_DIR: 24 files, 329/329 tests passed.
- Root typecheck: five workspaces successful.
- Browser: 75 field cases (five states × Master Rules 1–5 × 1200/390/320px), Domain docks, both reduced-motion settings, and long spectator names checked. A subsequent review identified the reveal-gate, compact-label and pile-frame fixes described above.

Priority labels preserve the LP counter's reserved change area. Compact boards use `To act` to keep names readable. Spectators see the name and `to act` together before the Turn chip, with the full name/action in visually hidden text and the tooltip.


Review-fix verification (2026-10-02):
- Web: 211 files, 2,422/2,422 tests passed, including room pause/reveal gates, the 8-second cap, CSS feedback, actor handoffs and turn-beat timing.
- Shared: 41 files, 378/378 tests passed, including saved and legacy snapshot priority cleanup.
- Duel server with the supplied `DUEL_DATA_DIR`: 24 files, 328/331 tests passed on the full run; three known Domain tests timed out at 5 seconds under load. The affected files passed alone: `domain-extra-bridge-invariants` 3/3, `domain-leave-tax` 3/3 and `domain-recall-kind` 2/2. Real set-trap priority/privacy and frozen/replay coverage passed.
- Root typecheck: five workspaces successful.
- Browser: 120 cases at 360/1200px across Master Rules 1–5, both player orientations and spectators, Domain on/off and reduced motion on/off. All player piles are framed; at 360px, short names fit fully and longer names retain at least 64px. Compact action labels, usable-card glows and reduced-motion pulse suppression checked.
- Independent code review: no critical or important issues remaining.
