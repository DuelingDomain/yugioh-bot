# Round 9: Niche fan-out and hybrid judge evidence

Run date: 2026-10-29. Node 22.23.3. Worktree `.worktrees/archetype-drilldown`, branch `feat/archetype-bridges`. Active judge and sentence-check model: **`claude-haiku-5-5`**.

## Niche fan-out

Deep results retain at most one Niche row per source card and entry card, using the existing ranking (two-way access, score, then target name). Generic Tuner search access stays in the explicitly searched archetype, rather than fanning out through hybrid search results. Junk Converter therefore retains Synchron. These rules use capabilities and graph membership, with no pair allowlist.

| Format | Strict rows before → after | Niche rows before → after |
| --- | ---: | ---: |
| Advanced | 244 → 244 | 2,209 → 1,195 |
| Genesys | 216 → 216 | 1,693 → 1,010 |

All 460 strict rows are exactly equal to the Round 8 rows. The rebuilt artifact contains 2,665 rows (2,205 Niche), 13,954 capabilities and 453 groups. Rebuild time: 888.463 seconds. Artifact version: `b9b443859776839888b06912e71fdbd81c9622ec7177a2645ebc28990d091426`.

Input hashes match Round 8: engine CDB `4c4025613e2fb7588ad8e520a16af72d9d7e509f7848a9bffec461f1cbcd0548`; metadata `277fa6df1616781fbcf6839c5a6537cda9616954e226d81d22c52aa971c85ac2`.

## Requested deep lists

These are deterministic deep-search candidate lists, capped at ten, before and after the rebuild. Only the Kashtira pair below was re-judged live. **N** marks deep-only Niche; other rows are Strict. Numbers are deterministic scores. The independent review gate still applies to player-facing results.

| Format / source | Before, in order | After, in order |
| --- | --- | --- |
| Advanced / Odion | Ashtra (10.99); Argostars (8.99); The Weather **N** (5.00); Gravekeeper's **N** (4.00); Altergeist **N** (3.99); Blue-Eyes **N** (1.48) | Ashtra (10.99); Argostars (8.99); The Weather **N** (5.00); Gravekeeper's **N** (4.00); Altergeist **N** (3.99); Blue-Eyes **N** (1.48) |
| Advanced / Blue-Eyes | Millennium (19.35); Black Luster Soldier (18.91); Chaos (16.89); Odd-Eyes **N** (9.60); Stardust **N** (8.95); Performapal **N** (7.89); Synchron **N** (7.68); Fleur **N** (4.59); Junk **N** (4.51); Speedroid **N** (4.26) | Millennium (19.35); Black Luster Soldier (18.91); Chaos (16.89); Synchron **N** (7.68) |
| Advanced / Snake-Eye | Fire King (9.16); Diabell (8.95); Dragon Ruler **N** (4.00) | Fire King (9.16); Diabell (8.95); Dragon Ruler **N** (4.00) |
| Advanced / Fiendsmith | Fabled (4.44) | Fabled (4.44) |
| Genesys / Odion | Ashtra (10.99); Argostars (8.99); The Weather **N** (5.00); Gravekeeper's **N** (4.30); Altergeist **N** (3.99) | Ashtra (10.99); Argostars (8.99); The Weather **N** (5.00); Gravekeeper's **N** (4.30); Altergeist **N** (3.99) |
| Genesys / Blue-Eyes | Millennium (19.35); Black Luster Soldier (18.91); Chaos (16.90); Stardust **N** (6.95); Synchron **N** (5.38); Fleur **N** (4.59); Junk **N** (4.51); Scrap **N** (4.20) | Millennium (19.35); Black Luster Soldier (18.91); Chaos (16.90); Synchron **N** (5.38) |
| Genesys / Snake-Eye | Fire King (15.94); Diabell (8.95); Dragon Ruler **N** (4.00) | Fire King (15.94); Diabell (8.95); Dragon Ruler **N** (4.00) |
| Genesys / Fiendsmith | Fabled (4.44) | Fabled (4.44) |

Blue-Eyes loses six of its seven visible Niche rows in Advanced, and four of five in Genesys. It ends with four total rows in each format. Odion, Snake-Eye and Fiendsmith are unchanged, including scores and order. The discarded Advanced Scrap fan-out also disappears from the wider candidate set.

## Kashtira → Tearlaments

The hybrid card was already present. The candidate supplied Tearlaments Kashtira and Tearlaments Cryme, but its only reason was `Tearlaments Kashtira names Tearlaments`; the proposed line had no steps. Earlier raw replies were recovered from the saved Round 7 session: both were invalid/risky with empty lines; the skeptic discussed the hand-Summon banish requirement and Cryme's GY recovery trigger. The replies contain no explicit verdict rationale. The evidence gap is the supported diagnosis: the candidate never articulated the useful hybrid interaction, and the replies focused on setup/recovery instead.

The evidence builder now derives a playable line for a shared source/target monster when its printed self-Summon and a matching target control condition are checked. It supplies the exact self-Summon clause, then explains that the controlled hybrid satisfies the target's printed monster requirement. It does not grant a search, Deck Set, activation, or waive other requirements. The code-written pro describes that condition rather than merely repeating a mention. The prompt and model were unchanged. The derived steps change `input_hash`, so old invalid reviews cannot satisfy the current gate.

For this pair the supported line is Tearlaments Kashtira → Tearlaments Cryme. Controlling Tearlaments Kashtira meets Cryme's Tearlaments-monster requirement. Cryme still needs its own legal Set/activation setup and triggering activation. Kashtira's banish happens as part of its resolving Summon effect, not as an activation cost. No guaranteed mill result, Fenrir search or Fusion extension is asserted.

| Judge | New verdict / grade | Verdict call | Sentence check | Total |
| --- | --- | ---: | ---: | ---: |
| mechanic | valid / niche | $0.001672 | $0.000525 | $0.002197 |
| skeptic | valid / niche | $0.001747 | $0.000513 | $0.002260 |

Gate: **shown / niche**. Total new live spend: **$0.004457**. One run, four successful calls, no service errors. This diagnostic used a disposable in-memory database; it did not publish approvals.

### Full shown text

Grade: **niche**.

Pros:

> Tearlaments Kashtira, while controlled, satisfies the monster requirement for Tearlaments Cryme's activation, subject to its printed conditions.

Cons: none shown.

Lock note: none shown.

Line: **Tearlaments Kashtira → Tearlaments Cryme**.

Warning: Card text conditions and costs apply; the line has not been engine-verified.

The shown projection selects the mechanic review when grades tie. Its three proposed cons were dropped by sentence checks. The skeptic retained two cons and one lock sentence; one other con was dropped. This is four `fact_check_no` drops overall. Raw and filtered replies are preserved in `.status/round9/kashtira-live.jsonl`; historical extracts are in `.status/round9/historical-kashtira.json`.

## Verification

- Item 1: 13 passing integration tests across the access, archetype pipeline and artifact suites.
- Final run: 80 passing integration tests across eight files: `bridge-access`, `bridge-judge`, duel-server `bridge-niche`, `bridge-api`, `bridge-search-jobs`, `bridge-workers`, scripts `bridge-batch`, and `bridge-evaluation`. This is 87 distinct passing tests across ten files overall; the six access tests were run in both groups.
- `scripts/effects/evaluate-bridges.ts --check --strict-precision` passed with both source and compiled shared resolution: precision 100%, coverage 100%, zero known false bridges, deep-only recall 100% in both formats. Strict recall at ten remains 19/29 Advanced and 18/27 Genesys.
- All four typechecks passed: shared, duel-server, web and effects scripts. Shared was rebuilt first. An initial shared typecheck before generated declarations existed reported implicit-any errors in unrelated tests; rebuilding shared resolved them.
- New catalog integration regressions were observed failing before their fixes, then passing. No unit tests were added.
- Read-only review found no important issues and checked all rebuilt Niche rows for repeated source/entry paths: zero duplicates.

Commands and logs:

```sh
npm run build --workspace=packages/shared
NODE_OPTIONS=--conditions=source node --import tsx scripts/effects/rebuild-bridges.ts --engine-directory /home/sulman633/repos/yugioh-bot/data/duel-engine --metadata .status/bridges/metadata.json
node --import tsx scripts/effects/evaluate-bridges.ts --check --strict-precision
npm run typecheck --workspace=packages/shared
npm run typecheck --workspace=packages/duel-server
npm run typecheck --workspace=packages/web
node node_modules/typescript/bin/tsc -p scripts/effects/tsconfig.json --noEmit
```

Integration commands use `NODE_OPTIONS=--conditions=source`, `node node_modules/vitest/vitest.mjs run`, the named `.integration.test.ts` files and `--maxWorkers=1`. Logs and before/after captures are in `.status/round9/`. The existing live script now accepts `--source Kashtira --target Tearlaments` to avoid rerunning other diagnostic pairs. The API key was loaded only into a subshell environment without printing it.

## Commits and cleanup

- `ab0c96470` — fix: limit Niche fan-out to one target per access path.
- The second item and this report are committed together as `fix: show checked hybrid control lines to bridge judges`.

Generated `dist`, `.next` and `*.tsbuildinfo` output was removed after verification. No engine-bundle writes, pushes, PRs, stashes, destructive resets or prohibited commit trailers. The read-only engine CDB hash was checked again after the rebuild.
