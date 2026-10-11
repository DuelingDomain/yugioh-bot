# Tag battle protection implementation plan

Goal: apply owner decision 2026-10-06 to the five applicable cards, and prove partner field material use.
Architecture: extend the existing Kuriboh Lua suffix pattern. Keep non-Tag paths and stock hash guards. Use real engine outcome scenarios.
Tools: Lua overlays, TypeScript DSL, Node 22, existing read-only engine bundle.

- [x] Fetch and merge origin/main without rebase. No conflicts occurred.
- [x] Check the stock scripts and card database, then confirm the official card text.
- [x] Add failing partner damage tests and 1v1/FFA controls in team-battle-protection.ts.
- [x] Extend c14146794 and c37780349; add c54569495, c60953118, c63009228. Recompute manifest counts.
- [x] Add R-TAG-TEAM-DAMAGE and regenerate rule coverage, including Kuriboh.
- [x] Run existing Tribute/Fusion/Xyz/Link field-material outcomes; add Synchro for both teams.
- [x] Run targeted engine and overlay checks. Review the diff and commit small changes with the required trailers.

Card text review:

- [Donyoribo @Ignister](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=14816&ope=2&request_locale=en): protects battle damage when an allied @Ignister is attacked. Keep the archetype condition.
- [Destiny HERO - Dynatag](https://www.db.yugioh-card.com/yugiohdb/card_search.action?keyword=Destiny+HERO+-+Dynatag&ope=1&rp=10&sess=1): protects battle damage, then each player takes 1000 effect damage. Keep the existing per-duelist burn once.
- [Marincess Crown Tail](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=14630&ope=2&request_locale=en): the hand effect halves damage after a successful summon; the grave effect prevents damage up to the Link Rating threshold. Apply both to the team, without repeating the summon or cost.
- [Arcana Force XIV - Temperance](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=7587&ope=2&request_locale=en): the discard effect prevents battle damage. Do not change its separate coin effect.
- [Rescue Interlacer](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=14449&ope=2&request_locale=en): protects battle damage when an allied Cyberse is attacked. Keep the race condition and later revival.
- [Giant Ballpark](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=13949&ope=2&request_locale=en): skip. This is a Field Spell that prevents both players' battle damage, not a hand effect that protects “you”.

Validation:

- Before the fix: 48 failed and 134 passed in the 182 damage scenarios. Failures showed missing partner activation or unprotected partner LP.
- Final targeted run: 480 passed, one optional local triage-file check skipped. No engine scenario skipped.
- Suites: team-battle-protection (222 outcomes), Kuriboh, Tag partner cost (Standard and Domain), manifest/hash checks, and rule coverage.
- Partner field materials: Tribute, Fusion, Xyz and Link outcomes existed; added Synchro for both teams and direct team-1 Fusion/Xyz/Link variants. All five summon types pass for both teams on Standard and Domain.
- Overlay check passed with 323 counted entries (585 manifest cards). Stock SHA-256 checks passed.
- Rule coverage regenerated: 46 rules covered, no pending or missing rule. Other changed coverage totals come from the current scenario inventory.
- Read-only code review found no functional defect. No core build, .build or .emcache was made. No data or cached engine files were changed.
