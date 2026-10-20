# PR 413 and 414 review fixes

Date: 2026-10-20. Use Node 22.23.3 and `prlimit --core=0`.

## Branches and CI

PR 412: `157fad4f93c4a0b15655b6d11905e03d4dcbaff2`. All checks passed in [run 39448057790](https://github.com/DuelingDomain/yugioh-bot/actions/runs/39448057790).

Both stacked branches already had the final PR 412 fixes at the start.
The previous local port and publish were complete. No PR was merged.

PR 413: `17a3d7d2e1bfe968037335bc68a1d3f242d8b270`. All checks passed in [run 39453849346](https://github.com/DuelingDomain/yugioh-bot/actions/runs/39453849346).

PR 414: `23d1120dc670c98c9ad98093d20f9e04f4b5d1c2`. All checks passed in [run 39452925546](https://github.com/DuelingDomain/yugioh-bot/actions/runs/39452925546).

All source branches and `test/local-all` were pushed. Poll `gh pr checks N --repo DuelingDomain/yugioh-bot` at two-minute intervals.

## Commits

Each row is one fix. Both required Claude trailers are present.

| PR | Fix | Source SHA | Local port SHA |
| --- | --- | --- | --- |
| 413 | fix(suggestions): isolate bounded scans from live duel operations | `d3e74507ec01f6ddb7757760c00fa0443411f4aa` | `b0cecebff6075a85e5c605784c1db68e4f4d29a5` |
| 413 | fix(suggestions): reserve consistent loading and empty row space | `f7b49fc4119e3497380ea1bc0faa98a6576aa9cd` | `08cb102626220611f048df05745c512115113ac3` |
| 413 | fix(suggestions): respect the configured Genesys remaining budget | `6fd325f6a3453e6fdc6951683831951e8a32c1ec` | `424a2a2a611ddd740193661016a13b0cb52c232f` |
| 413 | fix(suggestions): follow the selected Normal banlist region | `03f46c9eff70d7619155cbad123a0d305a5051d9` | `3a3a51aeb3c75d5f46ebf338ee219cc51fb54383` |
| 413 | docs(suggestions): retain concise evidence and remove raw work reports | `6db2d3ae94f5e3c1a057b1ec3580bf09ff37af76` | `9efd723cb261dfdea7774acedb07a28f3108cada` |
| 413 | fix(suggestions): identify draft queries by the full sorted pool | `f608e2ec3feb975fa8475bcd92d382e7d30ee305` | `b5eaaf103ff7a197d39c3ae99eaacccfb0d7634f` |
| 413 | test(suggestions): bound the serial cache proof with a CI-safe timeout | `17a3d7d2e1bfe968037335bc68a1d3f242d8b270` | `903d63f1d223638932d858b1b1eb65de825af60e` |
| 414 | fix(effects): bound bulk release HTTP responses | `fb665d8ce00c6b6974a432cf3e6c742896aea1c9` | `8d90f95af1382eeac34d6f391c569d69f297dd84` |
| 414 | fix(effects): expose and validate first-print corrections | `9e2bb0bbe46e2e4ad16504c9fcb6462e813f3bb4` | `61b99d746f29bd19aa82c7f78cfc04409b0b156e` |
| 414 | perf(effects): snapshot release metadata per catalog revision | `4ca3496fbe71dc54ead12956297dd1ee79b1a8fd` | `2599f9287a64090fb13740d3b33edd144dff6d01` |
| 414 | perf(effects): capture current month once per sort | `210b922ba24db1b21ed498fb610d0c1d033dd47d` | `dd4df9486b7d2d840908b131c12a63c2d8b87ae6` |
| 414 | ci(effects): remove daily bulk-response cache churn | `4830d0a99f42878d085ced9432fe93d64ec78de6` | `1e23e76d7dc73eead6a1ddeae370e1b5f35ff94b` |
| 414 | fix(web): share a tile row for prerelease and region marks | `fd91ddc321586abdc1fb7ecd42daa5dc1bd5073d` | `228feca16bbabdf84450c767480189ea0d727b06` |
| 414 | fix(cubes): preserve TCG-first era preferences | `b6721c4928dcea03959e8f0761f17dddef0246c7` | `423d06372fc8df33ed7ae3f8cbf805eee4011fed` |
| 414 | docs(effects): remove local work plans and personal runtime path | `d5e6b279a8a69912213f6e537bc0bb2906c3c5fa` | `9f5401f6ca89fba4058df3c76b83b439738d07d0` |
| 414 | ci(effects): explain required budget-ledger write permission | `6d512f0d632d0e0e8a2dc814f30bbb20373bd574` | `2fd94998ed097a17bf2bea7400425c1701447871` |
| 414 | fix(effects): retain prerelease-only cards in date searches | `23d1120dc670c98c9ad98093d20f9e04f4b5d1c2` | `7c0bd22b95a574df89536b2c21442ad052a9df3c` |

PR 412 fixes and prior local ports:

| Fix | Source SHA | Local port SHA |
| --- | --- | --- |
| Request deadlines and unpaid holds | `c9ca93289fbbc10307e9d2794d8362e4d3ce0d5b` | `44a1a49b8ce3fea9f523a3b84cd69a7cabd28150` |
| Dedicated ledger token | `4e40f0e2ed152f9709a74f356827da6e7ee19986` | `d71710c9e6955770687c4b04417211b1a4dc2046` |
| Artifact verification before the write lock | `805b90a5973da0d18744417c93f09c0e5a4ece4c` | `78c51efe9078e66c53c6bb39ffd46db2052cd0cb` |
| Flag-off random draft picks | `157fad4f93c4a0b15655b6d11905e03d4dcbaff2` | `d71c0ad918581870f3b717e15141a1e7a18c353c` |

The prior stacked merge commits are `02740b659d375471f3046ee40653ccbe04f04110` and `9f2b28131700b2c4e9af82e3582497f4e7795d88`.

## Checks

- Source PR 413: 19 host, 20 shared, 22 web route and 58 browser checks passed. The CI repair passed all 9 route integration checks.
- Source PR 414: 252 targeted integration checks passed.
- Local port: 22 shared, 138 duel and 9 web route integration checks passed. Five release-fill checks passed.
- Shared and staged duel builds, duel typecheck, Next webpack build and standalone packaging passed. No unit tests were added or run locally.
- The separate code review found no material issue in either source fix or the local conflict resolutions.

Ten uncached requests used the compiled production host and workers with 14,845 real catalog cards. Two returned 200; eight returned 429. Twenty live pinned-engine respond operations had p95 4.20 ms and max 4.52 ms. Baseline p95/max was 6.57 ms. Accepted scans took 407/409 ms. This test excludes network transport.

The release search check used a private copy of the 14,793-card catalog. Warm mean fell from 109.6 to 17.0 ms; p95 fell from 144.0 to 29.1 ms. The first search after an insert fell from 204.9 to 80.7 ms. Revision SQL per search fell from 48,538 to 1. All 393 results stayed the same.

The read-only prerelease engine has 139 prerelease rows. All have TCG or OCG bits. An in-memory projection to prerelease-only flags kept the same 129 recent results and order.

## Artifact write lock

A fresh online backup of the live DB had 14,793 catalog rows. Only the private copy was changed. The lock interval runs from BEGIN IMMEDIATE to the COMMIT callback; it excludes commit execution and has no competing writer.

| Import | Elapsed | Write lock |
| --- | ---: | ---: |
| First | 1841.47 ms | 857.69 ms |
| Repeat | 509.95 ms | 98.92 ms |

## Owner token steps

1. Create a fine-grained PAT under a repository writer account with no branch-rule bypass. Select resource owner DuelingDomain and only yugioh-bot.
2. Grant Contents read/write and the required Metadata read permission. Use a short expiry. Obtain organization approval if required.
3. Protect main: require a PR and approval, block force pushes and deletion, and give the token account no bypass.
4. Protect state/effect-tagging from force push and deletion. Permit fast-forward ledger updates. Keep the existing ledger.
5. Set EFFECT_TAGGING_LEDGER_TOKEN and EFFECT_TAGGING_LEDGER_REPOSITORY in the runtime secret manager. Restart the calling services. Add the runtime ANTHROPIC_API_KEY only after approval and protections are complete. Do not give runtime a general GITHUB_TOKEN.

Full steps: [effect-tagging.md](effect-tagging.md#owner-setup-runtime-ledger-token). Missing dedicated token means no paid call. The Actions tag job retains Contents write for ledger compare-and-swap; the free fill receives no token.

## Corrected cards in PR 414

Valid months can move earlier to the first print, never later. The PR description lists all 28 corrections. The original 27 exclude Des Koala; the final diff also includes that card.

| Card | Passcode | Previous TCG | First TCG |
| --- | --- | --- | --- |
| Uria, Lord of Searing Flames | 6007213 | 2006-03 | 2006-02 |
| Gaia The Fierce Knight | 6368038 | 2004-03 | 2002-03 |
| Orichalcos Shunoros | 7634581 | 2011-06 | 2010-03 |
| Musto, Oracle of Gusto | 9837195 | 2012-05 | 2012-02 |
| Exodius the Ultimate Forbidden Lord | 13893596 | 2010-11 | 2008-05 |
| Pumpking the King of Ghosts | 29155212 | 2004-12 | 2002-06 |
| Genesis Dragon | 31038159 | 2011-06 | 2010-03 |
| Crystal Beast Ruby Carbuncle | 32710364 | 2007-05 | 2007-01 |
| Malefic Truth Dragon | 37115575 | 2012-10 | 2011-03 |
| Levia-Dragon - Daedalus | 37721209 | 2004-03 | 2004-01 |
| Fairy King Truesdale | 45425051 | 2004-02 | 2003-11 |
| Trickstar Crimson Heart | 51011872 | 2018-02 | 2018-01 |
| The Supremacy Sun | 51402908 | 2013-07 | 2012-01 |
| Torrential Tribute | 53582587 | 2004-10 | 2003-03 |
| DoSolfachord Cutia | 55226153 | 2021-05 | 2021-04 |
| Darkness Neosphere | 60417395 | 2011-04 | 2009-11 |
| Stray Lambs | 60764581 | 2005-10 | 2004-03 |
| Transforming Sphere | 66094973 | 2011-08 | 2010-05 |
| Des Koala | 69579761 | 2005-03 | 2003-10 |
| Time Wizard | 71625222 | 2004-12 | 2002-06 |
| Ultimeat Offering | 76823930 | 2024-02 | 2024-01 |
| Slate Warrior | 78636495 | 2004-02 | 2003-11 |
| Cipher Soldier | 79853073 | 2004-02 | 2003-11 |
| The Tyrant Neptune | 88071625 | 2011-11 | 2010-05 |
| SolSolfachord Gracia | 91598270 | 2021-05 | 2021-04 |
| Crystal Beacon | 95326659 | 2007-05 | 2007-01 |
| The Six Samurai - Zanji | 95519486 | 2007-02 | 2007-01 |
| Call of the Haunted | 97077563 | 2004-10 | 2002-10 |

The initial 27 corrections are every correction above except Des Koala (added later). Additional fills: Mind Scan (34298391), unknown → 2019-01; Summoned Skull (70781052), unknown → 2002-03.

Missing-month fills: Mind Scan (34298391), TCG 2019-01; Summoned Skull (70781052), TCG 2002-03.

## Local publish

Published `test/local-all` at `903d63f1d223638932d858b1b1eb65de825af60e` on 2026-10-20 at 16:18 UTC.
The Next build used a separate output directory. The default output lost its generated CommonJS marker during the first build; the separate build passed.
The web unit was held by a systemd reference, stopped, copied with `.env*` excluded, and started. The gap was 0.48 s. The completed duel build was copied and its unit was restarted.

Both units are active with LimitCORE=0 and the no-env-read preload. Both retain the feature flags, database, engine path and sandbox allowlist.

Live owner checks passed:

- Signed host and web API answers match: hand trap has 183 hits; hand traps that negate has 48.
- Desktop and mobile browser checks passed, with the expected cards, chips and counts. There were no page errors.
- All 393 new-card results are ordered, with no unknown month in the current data. Upcoming and OCG marks are visible.
- Suggestions use four slots. The list top moved 0 px at 1366x768 and 1920x1080 after the real first answer. The prior check moved 1515 px.

Temporary web output, staged duel output and build DB files were deleted. Installed runtime files remain.

Evidence: `.status/review-followup/`. No credential, cookie or environment dump is saved. No environment file was read. No engine data was changed. Temporary build output and private DB copies were removed after the checks. Installed runtime files remain.
