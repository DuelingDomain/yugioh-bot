# Suggestions outside quality implementation

Approved scope: sections 2A–2D and acceptance checks in `data/briefs/effect-search/suggestions-outside-quality.md` in the main checkout. Execute in the supplied worktree; leave the concurrent bridge implementation untouched.

- [x] Add real-catalog integration coverage for false positives, positive routes, counterfactuals, row ownership and trusted admission. Observe failures before implementation.
- [x] Introduce a bounded utility evaluator: retain effect, target, payoff and practical conditions together; count target selectivity over the admitted catalog; use existing Main Deck copies for compositional routes.
- [x] Wire Outside discovery and ordering to that proof. Rank utility before roles, measured format/cohort usage, popularity and passcode. Keep generic staples in Staples with role reasons; allow underfilled rows.
- [x] Preserve common admission, copy, release, pool, Domain and Genesys checks; bump shared and host versions.
- [x] Run targeted integration checks, type checking and the existing Suggestions benchmark with authoritative host admission on scratch inputs. Capture actual saved deck 10/9/3 output.
- [x] Review only owned changes, delete generated build output, and commit with explicit paths and no attribution lines. Report SHAs and evidence.

Validation uses a SQLite backup opened from the live application read-only and a disposable copy of `data/engine-main-prerelease`, without opening `.env` files or the protected `data/duel-engine` directory. No new unit tests or runtime model calls.
