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
Core inputs are recorded in the checked-in pin files and patch series. Read those
files for current revisions; documentation does not duplicate card-data or script
pins. No core resources were modified or built for this feature.

## Transport and replay

Worker creation already transports full `DuelSettings`. The legacy adapter
passes those settings through, and journal creation clones the saved session
settings. Tests run actual workers and accepted placement commands through
`runJournalPrefix`, including target revision/state-digest recovery.

Replay source fingerprints now bind enabled Genesys settings. Missing/null
settings preserve the previous source hash. Main's host-rule version 6 is retained,
including its viewer-log redaction and
public move-source checks. Genesys adds opt-in creation rules through saved
settings; missing/null settings preserve the current non-Genesys behavior.
Live recovery keeps main's existing compatibility policy.

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

PR verification keeps real-worker, SQLite-backed deck-legality, and real-host
admission tests. Pure unit files and the obsolete host-rule fingerprint fixture
removed by the test cleanup stay deleted. See [the integration record](genesys-integration.md)
for the current checks, retained tests, and local engine-data limits.

## Integration status

- Shared view contract: `packages/shared/src/duels/index.ts` adds
  optional `DuelEngineView.field?: { genesys: boolean }`. Live, replay, Tag and FFA
  boards now consume that flag. FFA fields also mark the layout as having no EMZ
  and refresh crack geometry when its zone layout changes.
- Forward compatibility is covered. Earlier binaries do not implement Genesys;
  the preserved host-rule version does not distinguish them during rollback.
  Running newly recorded Genesys journals on those binaries is unsupported.
