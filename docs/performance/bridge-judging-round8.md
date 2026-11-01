# Round 8: deep-only Niche bridges

Run date: 2026-10-29. Node 22.23.3. Branch `feat/archetype-bridges`. Active verdict and sentence-check model remains **`claude-haiku-5-5`**.

Suggestions retain the strict top four. Deep search orders strict rows first, then access-backed Niche rows, returning at most ten rows that pass both independent reviews. Two-way Niche access ranks before one-way access. The existing usefulness grade and the deep-only tier are distinct.

## Candidate counts and preservation

| Format | Strict rows before / after | New Niche rows | Total rows |
| --- | ---: | ---: | ---: |
| Advanced | 244 / 244 | 2,209 | 2,453 |
| Genesys | 216 / 216 | 1,693 | 1,909 |

**3,902 new Niche artifact rows overall**, across both formats. All 460 strict rows are exactly equal to the saved Round 7 artifact rows, including scores, evidence and ordering. Strict normalization never sees deep-only evidence. These counts describe deterministic candidates, not approved player-facing rows.

The rebuilt catalog contains 13,954 capabilities and 453 groups. Algorithm: `capability-bridges-v6-access`. Artifact version: `e70cecb51a5dc61381f839dd6584d61493c4bf755ed6ccb9336883329ad8efad`. Rebuild time: 842.277 seconds.

The engine database and saved metadata match the preceding manifest inputs:

- Engine CDB SHA-256: `4c4025613e2fb7588ad8e520a16af72d9d7e509f7848a9bffec461f1cbcd0548`.
- Metadata SHA-256: `277fa6df1616781fbcf6839c5a6537cda9616954e226d81d22c52aa971c85ac2`.

## Requested deep-search candidate lists

**These are deterministic candidate lists, not fresh live approvals.** All listed rows pass checked evidence construction but remain pending in a fresh disposable import. This resumed environment has no configured Anthropic key, so no new live calls were made and no approvals were fabricated or exported. Both independent Haiku reviews still gate every runtime result. The browser proof uses API fixtures, and the API integration exercises the real gate with supplied review records.

Every line retains: **Card text conditions and costs apply; the line has not been engine-verified**. Strict rows may use an established rule-enabler or named-reference reason; each deep-only Niche row needs physical access.

### Odion — advanced

| Target | Tier | Score | Checked access / evidence |
| --- | --- | ---: | --- |
| Ashtra | Strict | 10.99 | Temple of the Kings permits same-turn activation of an already available Ashtra Trap, including Ashtra Divine Domain (strict rule-enabler). |
| Argostars | Strict | 8.99 | Temple of the Kings permits same-turn activation of an already available Argostars Trap, including Slayer Eteo (strict rule-enabler). |
| The Weather | Niche | 5.00 | Send face-up Continuous Trap Embodiment of Apophis for The Weather Painter Thunder's cost; Thunder places The Weather Thundery Canvas from Deck face-up. |
| Gravekeeper's | Niche | 4.00 | Discard Merciless Scorpion of Serket (EARTH Fairy) for Mudora the Sword Oracle; Mudora Special Summons itself, then places Gravekeeper's Trap from Deck face-up. |
| Altergeist | Niche | 3.99 | Altergeist Marionetter Sets Altergeist Emulatelf from Deck; Temple of the Kings permits activation that same turn. |
| Blue-Eyes | Niche | 1.48 | The Man with the Mark is the complete material for Spirit with Eyes of Blue; Spirit Tributes itself to summon Blue-Eyes White Dragon from hand/GY. Its while-face-up Dragon restriction ends with that self-Tribute. |

### Blue-Eyes — advanced

| Target | Tier | Score | Checked access / evidence |
| --- | --- | ---: | --- |
| Millennium | Strict | 19.35 | Heart of the Blue-Eyes: search → Millennium Ankh |
| Black Luster Soldier | Strict | 18.91 | Chaos Form names Black Luster Soldier |
| Chaos | Strict | 16.89 | Chaos Form names Chaos |
| Odd-Eyes | Niche | 9.60 | Discard Sage with Eyes of Blue (Tuner) and Junk Converter; Converter searches Performapal Odd-Eyes Synchron from Deck. |
| Stardust | Niche | 8.95 | Discard Sage with Eyes of Blue (Tuner) and Junk Converter; Converter searches Stardust Synchron from Deck. |
| Performapal | Niche | 7.89 | Discard Sage with Eyes of Blue (Tuner) and Junk Converter; Converter searches Performapal Odd-Eyes Synchron from Deck. |
| Synchron | Niche | 7.68 | Discard Sage with Eyes of Blue (Tuner) and Junk Converter; Converter searches Starjunk Synchron from Deck. |
| Fleur | Niche | 4.59 | Discard Sage with Eyes of Blue (Tuner) and Junk Converter; Converter searches Fleur Synchron from Deck. |
| Junk | Niche | 4.51 | Discard Sage with Eyes of Blue (Tuner) and Junk Converter; Converter searches Jet Synchron from Deck. |
| Speedroid | Niche | 4.26 | Discard Sage with Eyes of Blue (Tuner) and Junk Converter; Converter searches Speedroid Wing Synchron from Deck. |

### Snake-Eye — advanced

| Target | Tier | Score | Checked access / evidence |
| --- | --- | ---: | --- |
| Fire King | Strict | 9.16 | Snake-Eye Ash reaches Legendary Fire King Ponix; Ponix can search Fire King Island after its own Summon. |
| Diabell | Strict | 8.95 | Dramatic Snake-Eye Chase places Diabellstar Vengeance in the Spell & Trap Zone as a Continuous Spell; this is not an immediate monster Summon. |
| Dragon Ruler | Niche | 4.00 | Discard Snake-Eyes Flamberge Dragon and Burner, Dragon Ruler of Sparks; Burner Special Summons Blaster, Dragon Ruler of Infernos from Deck. |

### Fiendsmith — advanced

| Target | Tier | Score | Checked access / evidence |
| --- | --- | ---: | --- |
| Fabled | Strict | 4.44 | Fiendsmith's Tract: search → Fabled Miztoji |

### Odion — genesys

| Target | Tier | Score | Checked access / evidence |
| --- | --- | ---: | --- |
| Ashtra | Strict | 10.99 | Temple of the Kings permits same-turn activation of an already available Ashtra Trap, including Ashtra Divine Domain (strict rule-enabler). |
| Argostars | Strict | 8.99 | Temple of the Kings permits same-turn activation of an already available Argostars Trap, including Slayer Eteo (strict rule-enabler). |
| The Weather | Niche | 5.00 | Send face-up Continuous Trap Embodiment of Apophis for The Weather Painter Thunder's cost; Thunder places The Weather Thundery Canvas from Deck face-up. |
| Gravekeeper's | Niche | 4.30 | Discard Merciless Scorpion of Serket (EARTH Fairy) for Mudora the Sword Oracle; Mudora Special Summons itself, then places Gravekeeper's Trap from Deck face-up. |
| Altergeist | Niche | 3.99 | Altergeist Marionetter Sets Altergeist Emulatelf from Deck; Temple of the Kings permits activation that same turn. |

### Blue-Eyes — genesys

| Target | Tier | Score | Checked access / evidence |
| --- | --- | ---: | --- |
| Millennium | Strict | 19.35 | Heart of the Blue-Eyes: search → Millennium Ankh |
| Black Luster Soldier | Strict | 18.91 | Chaos Form names Black Luster Soldier |
| Chaos | Strict | 16.90 | Chaos Form names Chaos |
| Stardust | Niche | 6.95 | Discard Sage with Eyes of Blue (Tuner) and Junk Converter; Converter searches Stardust Synchron from Deck. |
| Synchron | Niche | 5.38 | Discard Sage with Eyes of Blue (Tuner) and Junk Converter; Converter searches Starjunk Synchron from Deck. |
| Fleur | Niche | 4.59 | Discard Sage with Eyes of Blue (Tuner) and Junk Converter; Converter searches Fleur Synchron from Deck. |
| Junk | Niche | 4.51 | Discard Sage with Eyes of Blue (Tuner) and Junk Converter; Converter searches Jet Synchron from Deck. |
| Scrap | Niche | 4.20 | Discard Sage with Eyes of Blue (Tuner) and Junk Converter; Converter searches Scrap Synchron from Deck. |

### Snake-Eye — genesys

| Target | Tier | Score | Checked access / evidence |
| --- | --- | ---: | --- |
| Fire King | Strict | 15.94 | Original Sinful Spoils - Snake-Eye reaches Legendary Fire King Ponix; Ponix can search Fire King Island after its own Summon. |
| Diabell | Strict | 8.95 | Dramatic Snake-Eye Chase places Diabellstar Vengeance in the Spell & Trap Zone as a Continuous Spell; this is not an immediate monster Summon. |
| Dragon Ruler | Niche | 4.00 | Discard Snake-Eyes Flamberge Dragon and Burner, Dragon Ruler of Sparks; Burner Special Summons Blaster, Dragon Ruler of Infernos from Deck. |

### Fiendsmith — genesys

| Target | Tier | Score | Checked access / evidence |
| --- | --- | ---: | --- |
| Fabled | Strict | 4.44 | Fiendsmith's Tract: search → Fabled Miztoji |

Odion → Paleozoic is absent in both formats. A Trap activation permission without a real access edge is insufficient; generic any-Trap toolboxes do not qualify. Odion → Blue-Eyes is absent in Genesys because its selected material path requires a Link Monster. Same-deck families, excluded name-label groups, wide-filter-only links and negated entry chains remain excluded.

## Access review fixes

- Discovery and judge validation share the complete versioned capability graph. A small evidence-card subset cannot incorrectly make a wide filter appear specific.
- Costs bind the supplied source card to the same effect as its named output. The source must be in a usable zone; field costs cannot assume an unsupported Extra Deck Summon.
- Typed costs such as Simorgh Onslaught discarding a Blackwing Winged Beast are supported without a pair allowlist. Lillybot's unconditional once-per-turn Machine Tribute is also supported.
- Conditional targeting setups, such as Priestess with Eyes of Blue, need evidence and are excluded when it is missing. Gearfried cannot assume a Blue-Eyes Equip was equipped to it. Lu Jing's send after the semicolon is an effect, not a cost.

## Golden evaluation

`scripts/effects/evaluate-bridges.ts --check --strict-precision` passed. Deep-only positives are excluded from strict precision/recall denominators.

| Format | Strict precision / coverage at 5 | Strict recall at 4 | Strict recall at 10 | Deep-only recall at 10 | Known false bridges |
| --- | --- | --- | --- | --- | --- |
| advanced | 13/13 = 100% / 100% | 62.07% | 19/29 = 65.52% | 2/2 = 100% | 0 |
| genesys | 13/13 = 100% / 100% | 62.96% | 18/27 = 66.67% | 1/1 = 100% | 0 |

Deep positives: Advanced Odion → Blue-Eyes and Odion → Altergeist; Genesys Odion → Altergeist. All meet minimum grade Niche. Paleozoic is a deep negative in both formats.

## Verification

**107 targeted integration tests passed across 13 files**, using the rebuilt artifacts. The web routes were run with `packages/web/vitest.config.ts` for their `@/` alias. The strict two-way API fixture now selects strict rows on both sides; Niche behavior has separate integration coverage.

- Shared: `bridge-access.integration.test.ts`, `archetype-bridges.integration.test.ts`, `bridge-round3.integration.test.ts`, `bridge-judge.integration.test.ts`.
- Duel server: `bridge-niche.integration.test.ts`, `bridge-api.integration.test.ts`, `bridge-search-jobs.integration.test.ts`, `bridge-workers.integration.test.ts`, `deck-suggestion-workers.integration.test.ts`.
- Effects scripts: `bridge-evaluation.integration.test.ts`, `bridge-artifacts.integration.test.ts`, `bridge-batch.integration.test.ts`.
- Web: `card-bridges-route.integration.test.ts` (12 tests).

All four typechecks passed: shared, duel-server, web and effects scripts. Shared was rebuilt after updating the artifact integrity pin. The golden CLI also passed using the compiled shared package, independently of source-conditions resolution.

Commands used Node 22.23.3. Integration runners used `--maxWorkers=1`, `NODE_OPTIONS=--conditions=source`, and the existing read-only `DUEL_DATA_DIR`. The web route invocation was:

```sh
node node_modules/vitest/vitest.mjs run --config packages/web/vitest.config.ts tests/card-bridges-route.integration.test.ts --maxWorkers=1
node --import tsx scripts/effects/evaluate-bridges.ts --check --strict-precision
npm run typecheck --workspace=packages/shared
npm run typecheck --workspace=packages/duel-server
npm run typecheck --workspace=packages/web
node node_modules/typescript/bin/tsc -p scripts/effects/tsconfig.json --noEmit
```

Verification logs are in `.status/round8-integration.log`, `.status/round8-api-integration.log`, `.status/round8-web-integration.log`, `.status/round8-evaluation.json` and `.status/round8-evaluation-compiled.json`. The first aggregate run included the web tests without their alias config and selected a Niche pair for a strict API fixture; the correctly configured web run and the corrected API fixture both passed.

The browser proof passed **138 checks**, including strict-before-Niche ordering, ten-row cap, explicit Niche labels, unchanged four-row Suggestions and desktop/phone layout. Evidence and screenshots: `.status/round8-e2e/evidence.json` and `.status/round8-e2e/`.

No new unit tests, engine-bundle writes, pushes, PRs, destructive resets or stashes. Generated `packages/shared/dist` and `packages/web/tsconfig.tsbuildinfo` were removed after verification. The worktree and commits are preserved. The read-only engine CDB hash was checked again after the rebuild and is unchanged.

## Commits

- `aa4f070a6` — docs: record deep-search Niche implementation plan
- `a449201e6` — feat: derive deep-only Niche bridges from checked access paths
- `9b17754a6` — fix: ground Niche reviews in material, cost and Deck Set evidence
- `79bf39994` — feat: show up to ten judged bridges exclusively in deep search
- `0bbe0154a` — fix: validate Niche access against the complete stored graph
- `df773bdd7` — fix: require payable printed costs for Niche access
- `696848b98` — feat: label and cap deep-search Niche results in the UI
- `51eccc048` — test: keep strict two-way API coverage separate from Niche rows
- `95fe52de6` — chore: rebuild access-backed Niche bridge artifacts
- `c6b3fdcc0` — test: evaluate deep-only bridge recall separately from Suggestions
- `ca47ba6c3` — docs: describe deep-only Niche bridges and evaluation

The final report and completed plan are committed separately after these implementation, fixture, artifact and API-documentation commits.

## Round 7 reference

The exact ten-pair verdicts, shown pros/cons/lock notes, all 31 dropped sentences and reasons, per-pair costs and remaining rules/setup notes are retained in [bridge-judging-round7.md](bridge-judging-round7.md). Its final run showed nine pairs, rejected one, cost $0.044273, and found no direct contradiction in shown rules text. All Round 7 diagnostic passes cost $0.119211.
