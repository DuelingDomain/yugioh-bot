# Deck Master rulebook v1.4 core corrections

Owner approval: 2026-10-04. Scope: pinned 1v1 Domain, multiplayer Domain, and legacy 1v1 Domain. One commit per rulebook gap; no deployment.

## Audit evidence at baseline d805924e

| Gap | Rulebook lines | Cause and affected paths |
| --- | --- | --- |
| K22 / gap 1 | 193–199 | `domain-core/src/apply-domain-patch.mjs:944` passed the Pendulum activation effect as the tax reason. `domain-core/pins.json:34` explicitly documented Spell Economics waiving that tax. Legacy repeats this at `legacy-1v1/domain-core/src/apply-domain-patch.mjs:929` and `legacy-1v1/domain-core/pins.json:34`. |
| K20 | 190–191 | `domain-core/src/domain_master.cpp:185` raised only `EVENT_LEAVE_GRAVE`. The legacy copy has the same code. `domain-core/src/apply-domain-multi.mjs:258` adapts the recall event's no-player sentinel for multiplayer. The pinned engine defines `EVENT_LEAVE_GRAVE` and `EVENT_MOVE`, but no dedicated leave-hand, leave-Deck or leave-banishment event; those departures are represented by `EVENT_MOVE` and previous-location metadata. |
| K4 | 136 | `domain-core/src/apply-domain-patch.mjs:492` and its legacy copy allow effects with `EFFECT_FLAG_IGNORE_IMMUNE` through DMZ immunity. The stock `card::is_capable_be_effect_target` also lacks a DMZ exclusion. |
| K13 | 166–168 | `domain-core/src/apply-domain-patch.mjs:153` and its legacy copy require `DUEL_FSX_MMZONE` for a non-Link DM's unrestricted Main Monster Zone placement. `src/engine.ts:276` accepts MR1–5; `src/host.ts:2164` allows these values. ADR-0002:5 restricts only multiplayer to MR5, so MR4 Domain 1v1 is reachable. |

## Implementation and verification plan

1. K22: use the same locked null LP-cost reason as other DMZ leaves; update both pins and ADR. Add `tests/domain/action-cost.test.ts` with actual Spell Economics and a cumulative 500/1000 LP Pendulum scenario, plus a Chain Energy control.
2. K20: raise single and grouped move events for all recall origins, retaining leave-GY events and rule metadata. Adapt every multiplayer sentinel. Add `tests/domain/recall-events.test.ts` with previous-zone trigger scenarios.
3. K4: block other cards even with ignore-immunity, reject effect targeting, and retain permitted summon procedures. Add `tests/domain/immunity.test.ts` with external effect/target probes and summon controls.
4. K13: apply the non-Link DM placement exception independently of MR5; retain Link zone restrictions. Add `tests/domain/placement.test.ts` covering reachable Master Rules and ordinary Extra Deck controls.

Before each core change, run its scenario against the previous binary and confirm the expected failure. After each change, rebuild all three Domain variants with `packages/duel-server/scripts/build-domain-core.ts` inside the pinned emsdk 4.0.9 image. Every build holds the supplied `core-build.lock`, uses at most two compiler jobs, and writes the engine bundle to `.build/dm-bugs/engine`. Run targeted Vitest files with `--maxWorkers=1 --no-file-parallelism --testTimeout=15000` and `prlimit --core=1:1`. Record rebuilt binary hashes in both expected-sha256 files and deployment/legacy documentation, check them, and commit that bug. Remove the private engine bundle, compiler outputs, and temporary test overlays after final verification.

## Verified cores after K22

| Core | SHA-256 |
| --- | --- |
| domain | `7f9973f11e00a666ed2ee212bccec6ed29233fe1ddb49edabbc9d394bc6019d3` |
| multi-domain | `968c07082a4067a268c472b555b4cbac120005ce4e8cce7d3e0ed8733e9e0640` |
| legacy | `0e17cec814aff694f2573f07940c404440595a93c7437a57e93c58bdc72735dd` |

K22 verification: the baseline scenario failed at 8000 LP versus the required 7500. After rebuilding, 10/10 scenarios passed on pinned, legacy core, FFA3, FFA4 and Tag. The legacy build initially rejected the intentionally changed wasm against its old pin; the new measured pin passes `check-legacy-pin.sh`.

## Verified cores after K20

| Core | SHA-256 |
| --- | --- |
| domain | `b2e584882f9e20bf22ad433d8ddac37bc06ef3514faf0bc5562fe9de48ab27b2` |
| multi-domain | `7c46642b0ad3d4327a13107bf486a25579dcb080aa193363ca52593d2053fc27` |
| legacy | `323bac7e53b31591c6f1ff27c01504dfa46cbe8d9dbf509abcede0ff55e5d92c` |

K20 verification: all five move-origin scenarios failed before the change. After rebuilding, 30/30 departure scenarios passed across pinned, legacy, FFA3, FFA4 and Tag, including the leave-GY control. The existing recall-kind tests passed 2/2. With the final fixture helper, departure and action-cost scenarios passed together 40/40. Lua sees the native multiplayer no-player sentinel as `PLAYER_NONE`, as required by the perspective fold.
