# Bridge approach review follow-up — 2026-10-31

The Opus follow-up is addressed in the mechanic nomination predicates, observed-pair shortlist, runtime artifacts, Docker packaging, and integration coverage. The owner-confirmed Fiendsmith → Labrynth rejection holds in Advanced and Genesys; Temple of the Kings → Labrynth retains its permission/resource/trigger evidence.

Implementation commit: `68c485605`.

## Corrected behavior

- GY setup requires a named card or archetype filter and a matching printed Deck-to-GY action clause. Type-only, Attribute-only, Level-only, empty, random/excavation, and unrelated evidence clauses are rejected. Inferred membership labels alone cannot establish the recipient identity; the scan exposed and now rejects Delta The Magnet Warrior → Symphonic Warrior Synthess.
- A generic Normal Trap trigger requires at least two Normal Traps covering at least 40% of legal source members. The explicit activation-permission plus target-resource branch remains available, including Temple of the Kings with Welcome Labrynth and Lady Labrynth.
- Observed rows below the score floor must pass deterministic validation, avoid hubs, and have a physical access path. The candidate is rebuilt from those rows so a rejected companion cannot supply its score or displayed link. Current two-judge publication requirements remain in force.
- Bot, ws, duel, and worker images copy `bridge-observations.json`; their effects directory also includes the new mechanic facts. Missing/invalid observations emit one warning per process, then retain the existing fallback.
- Mechanic checks read a 180,206-byte bit-mask artifact for 13,694 cards. An isolated first fact lookup took 12.8 ms on this host; it performs no full-tag read/decompression. The source tags hash and artifact identity are verified in the offline publication flow, which rebuilds/stages facts with bridge updates.
- Discovery versioning is lazy and includes both fact and observation versions. Importing the shared effects barrel reads neither artifact. Web output tracing excludes tags, mechanic facts, and observations; standalone packaging also removes stale copies before its own trace. Docker filters the effects directory before copying it into the web runtime layer.
- `usage.json` is now 697,353 bytes, down from 1,670,095. Its parsed contents and version are unchanged, and the refresh writer emits compact JSON.

## All-pairs scan

Each format visits all 204,756 directed, distinct-name pairs across 453 groups through `BridgeEngine.synergyBetween`. Counts below include reasons with `mechanic`; existing non-mechanic resource synergies are outside this tally. Full rows, provider clauses, recipient text, graph identity and fact identity are in [the scan artifact](bridge-approach-review-2026-10-31.json).

| Format | Total mechanic rows | GY setup | Trap trigger | Trap activation | Discard trigger |
|---|---:|---:|---:|---:|---:|
| Advanced, Opus baseline | 4,928 | 4,825 | 57 | 3 | 43 |
| Advanced, corrected | 73 | 17 | 8 | 3 | 45 |
| Genesys, corrected | 73 | 14 | 4 | 1 | 54 |

Removing an invalid higher-priority GY nomination can expose a valid discard branch, which explains the Advanced discard increase. These are deterministic pending proposals; the scan does not grant judge approval.

Ten corrected Advanced GY samples:

| Source → target | Named provider → GY consumer |
|---|---|
| Atlantean → Mermail | Poseidra, the Storming Atlantean → Mermail Abyssmander |
| Bystial → Branded | Bystial Saronir → Branded Retribution |
| Gogogo → Dododo | Gogogo Goram → Onomatokage |
| Mekk-Knight → Knightmare | Girsu, the Orcust Mekk-Knight → Orcust Knightmare |
| Mekk-Knight → Krawler | Girsu, the Orcust Mekk-Knight → World Legacy's Mind Meld |
| Mekk-Knight → Orcust | Girsu, the Orcust Mekk-Knight → Orcust Crescendo |
| Mekk-Knight → World Chalice | Girsu, the Orcust Mekk-Knight → World Legacy - "World Chalice" |
| Odd-Eyes → Performapal | Performapal Odd-Eyes Seer → Performapal Ladyange |
| Shark → Scrap | Scrap Shark → Scrap Mind Reader |
| Synchron → Speedroid | Speedroid Wing Synchron → Speedroid Dupligate |

## Verification

- Duel approach/recall/jobs/synergy/engines/workers integration run: 66 passed across six files. The final approach suite, including named-GY positive evidence and structural companion rejection, was rerun: 8 passed.
- Shared archetype-bridges/bridge-engines/bridge-judge/bridge-set-access integration run: 64 passed across four files.
- Web bridge route integration run: 34 passed.
- Artifact generation, missing-artifact/lazy-import behavior, web standalone packaging, refresh publisher, and bridge publication integrity: 5 passed across three integration files. The packaging fixture includes stale discovery files and confirms their removal.
- Shared and duel-server TypeScript checks passed. Effects scripts check passed with `--rootDir .`; the checked-in script config's narrower root otherwise rejects existing cross-package source imports.
- `git diff --check` passed. A read-only independent review reported no findings.

Commands used `node_modules/.bin/vitest run --maxWorkers=1` with the explicit integration paths above; shared and duel-server runs used `--testTimeout=30000`. Type checks used `node_modules/.bin/tsc -p packages/shared/tsconfig.json --noEmit`, the corresponding duel-server config, and `-p scripts/effects/tsconfig.json --rootDir . --noEmit`.

No full Docker/Next build was run. The real standalone packager and its dependency trace were exercised without starting a web server or loading environment files. All database writes were confined to integration fixtures; the live :3000 database and `data/duel-engine` were untouched. Generated build output and test scratch trees were removed after verification.
