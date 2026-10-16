# Genesys engine field zones

Genesys is enabled by `settings.genesys != null`, including a zero point cap.
The pinned and legacy 1v1 engines clear these `ocgcore-wasm` flags from the
selected Master Rule before creating either a normal or Domain duel:

| Flag | Value |
| --- | --- |
| `PZONE` | `0x800` |
| `SEPARATE_PZONE` | `0x1000` |
| `EMZONE` | `0x2000` |

The pinned engine also creates Tag/FFA3/FFA4 through the multi/multi-domain
cores with the same mask. Other Master Rule flags and the existing first-turn
draw selection remain intact. Multiplayer stays MR5: removing zone bits does
not introduce the old-rule flags rejected by `Debug.SetupDuelists`, so the
shared service's MR5 guard needs no change.

The supplied engine-facing cores honor the flags without patches or rebuilds.
Both multiplayer SOURCE files match the checkout's ygopro-core, wrapper and Lua
pins and the complete 104-patch series (SHA-256
`8f26289b1ae1102a0a03cac1db516e1927e813fb517884c64c557d05e418afaf`).
No core resources were modified or built.

## Transport and replay

Worker creation already transports full `DuelSettings`. The legacy adapter
passes those settings through, and journal creation clones the saved session
settings. Tests run actual workers and accepted placement commands through
`runJournalPrefix`, including target revision/state-digest recovery.

Replay source fingerprints now bind enabled Genesys settings. Missing/null
settings preserve the previous source hash. The host-rule fingerprint is
refreshed at version 5 because existing sources retain identical creation flags,
projections and journal interpretation. Preserving that identity also preserves
recovery of older active replay forks.

## Field view contract

Enabled views expose `view.field = { genesys: true }` to every player and
spectator, including rebuilt replay views. Off/old views omit `field`.
Multiplayer views set every seat's `sharedExtraWith` to null when Genesys is on;
the core's facing-pair capability cannot create shared zones in this layout.

The existing seven/eight-entry monster/spell arrays retain their transport
shape. Board consumers should use `view.field?.genesys === true` to omit EMZ/PZ
slots. Ordinary Spell/Trap slots 0 and 4 still exist: MR5 sharing those slots
with Pendulum Zones does not make them Pendulum Zones in Genesys.

## Verification

`genesys-engine-real.test.ts` covers 32 real-worker cases:

- Normal and Domain, pinned and legacy 1v1, plus Tag/FFA3/FFA4 on the installed
  multi cores, with Genesys both on and off (20 cases).
- Extra Deck Fusion placement offers exactly MMZ 0-4 in Genesys and MMZ+EMZ 0-6
  in controls; the summoned Fusion occupies a Main Monster Zone.
- A Pendulum fixture has no activation action in Genesys and retains it in
  controls. This probes engine geometry independently of deck admission.
- Saved commands rebuild identical player/public fields and state digests.
- Missing versus explicit-null Genesys settings produce identical openings
  on all ten core/mode/table variants.
- Both 1v1 engines under MR3 clear separate PZ flags and preserve the other
  MR3 summon rules; zero point caps still enable Genesys.

The focused regression run also includes `engine-resource-resolver`,
`views-shared-extra`, `journal-runner`, `replay-cursor`, `engine-settings`, and
`standard-engine-worker` tests. Build shared before consumers, use Node 22, and
set `DUEL_DATA_DIR` to the prepared engine bundle and `DUEL_REQUIRE_CORES=1`.

Final verification: **181 tests passed across seven focused files**, including
all 32 Genesys real-worker cases. The shared build, duel-server typecheck and
`git diff --check` passed. Read-only code review found no critical or important
issues; its compatibility finding led to preserving the historical host-rule identity.

## openIssues

- Minimal shared contract change: `packages/shared/src/duels/index.ts` adds
  optional `DuelEngineView.field?: { genesys: boolean }`. Table UI work should
  consume that flag; this branch does not change UI files.
- Forward compatibility is covered. Earlier binaries do not implement Genesys;
  the preserved host-rule version does not distinguish them during rollback.
  Running newly recorded Genesys journals on those binaries is unsupported.
