# Legacy 1v1 engine inputs

This folder holds what the legacy 1v1 engine needs, copied from `main` at commit `2a5a959`
(the merge base of the multiplayer merge). The legacy engine plays 1v1 Standard and Domain duels
exactly as production did before the n-seat work. `DUEL_1V1_ENGINE=legacy` selects it (the default).

See `docs/deployment/duel-engine-switch.md` for the switch and for how to roll back.

## Files

- `domain-core/pins.json`, `domain-core/src/*`, `domain-core/lua/domain.lua`: main's Domain core inputs, unchanged.
- `scripts/build-domain-core.sh`: main's `build-domain-core.sh` with changes marked `LEGACY-1V1`.
  It reads the files above and writes `ocgcore.domain.legacy.wasm` and `card-scripts/domain.legacy.lua`
  into the engine data directory, with its own manifest keys (`domainLegacyWasm`, `domainLegacyLua`, `domainLegacyPatch`).
- The Standard legacy core needs no file here. It is the core inside the `ocgcore-wasm` npm package (`lib/ocgcore.sync.wasm`).
  The wrapper patch (`patches/ocgcore-wasm+0.1.2.patch`) does not change that wasm.

## Proof that the legacy files equal main's

| File | sha256 |
| --- | --- |
| `ocgcore.domain.legacy.wasm` | `1ca9f3187fb534579e843264ba6c06a0b281c81f17fb064c6d4cc66f32c84c3d` |
| `domain.legacy.lua` (equal to main's `domain.lua`) | `405c8a09716128cb0f63b34f25d9dbed2e9fcf6748d57d45329fb61d2166ae99` |

The wasm has the same sha256 as the wasm that main's own script builds from a clean clone of `2a5a959`.
Both builds ran in `docker.io/emscripten/emsdk:4.0.9` with `--user "$(id -u):$(id -g)"`.

## Build

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/src -w /src \
  docker.io/emscripten/emsdk:4.0.9 \
  bash packages/duel-server/legacy-1v1/scripts/build-domain-core.sh
```

Or `npx tsx packages/duel-server/scripts/build-domain-core.ts legacy-domain`.

## Code

The legacy engine code is in `packages/duel-server/src/legacy/` (main's `engine.ts`, `views.ts` and `prompts.ts`
with small changes marked `LEGACY-1V1`, and `index.ts`, which adapts them to the `EngineGame` interface).
