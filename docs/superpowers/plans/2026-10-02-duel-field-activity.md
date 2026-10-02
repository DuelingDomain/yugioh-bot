# Duel field turn and priority

**Goal:** Keep the turn player's zones marked in gold and the current prompt owner's zones marked in purple, including opponent response windows.

**Architecture:** Add optional public `prioritySeat` metadata to `DuelEngineView`. The engine projection publishes the pending prompt's seat to every viewer while retaining prompt privacy. A pure web helper derives activity; `DuelField` renders separate edges and tally labels, withholding priority through the existing board animation gate plus finite CSS and phase-beat checks, without showing priority when effects exceed the prompt timeout. Replay frames clear priority because recorded decisions are not live requests.

**Design:** Reuse the field's gold (`#e4b64f`) and purple (`#9b7eff`), existing typography and fit system. Gold is steady with a faint tint. Purple is a slim breathing edge. Both can appear on one half. Labels read `Turn`, `Your move`, or `Opponent to act`; spectators see the player's name. No overlay over cards, no inactive-side dimming. Reduced motion disables the pulse.

**Constraints:** Work on the current branch. Leave the other agent's room, lobby, seat and service changes untouched. Do not touch `.worktrees`, card backs, services or port 3100. Stage only owned paths.

- [x] Add failing projection tests for both players, spectators, no pending prompt and finished duels.
- [x] Add failing derivation and field rendering tests for split/shared ownership, legacy snapshots, reversed viewing seat, no actor and animation gates.
- [x] Publish optional priority metadata; clear it on frozen views and replay frames.
- [x] Implement derivation, field edges and tally labels; preserve all Master Rule layouts and Domain support.
- [x] Add five Board states lab scenes with real projected prompt ownership and a usable-card glow.
- [x] Run web tests, shared tests, duel-server tests with the supplied engine data path, and root typecheck. Re-run isolated known flaky tests if needed.
- [x] Review diff and file ownership, commit owned paths with the requested co-author trailer, and report results.

Verification (2026-10-02):
- Web full run: 210 files, 2,408 tests; 2,404 passed and four known DB route flakes. Affected files passed alone: decks-draft-route 31/31, drafts-deck-pool-route 10/10, tournaments-slug-route 8/8. New derivation/rendering coverage passed 49/49.
- Shared: 41 files, 377/377 tests passed.
- Duel server with the supplied DUEL_DATA_DIR: 24 files, 329/329 tests passed.
- Root typecheck: five workspaces successful.
- Browser: 75 field cases (five states × Master Rules 1–5 × 1200/390/320px), Domain docks, both reduced-motion settings, and long spectator names checked. Independent review verified finite CSS banner gating and the fitted header labels; no remaining findings.

Priority labels sit beside the existing ellipsized name and Turn chip. This preserves the LP counter's reserved change area. Spectators read the displayed name plus to act, with the full name/action in the accessible label and tooltip.
