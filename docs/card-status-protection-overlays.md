# Active protection script overlays

The host adds public card hints for 20 measured protection cards. The Lua suffixes
only describe protection effects already applied by the core. They do not change
costs, targets, immunity values, conditions, summoning rules or reset timing.

## Selection and rationale

The evidence is the checked-in 2026-10-20 format sample described in
[format-staples.md](format-staples.md):
`packages/shared/data/staples/decks.json` contains 79 TCG, 75 Domain and 80 Genesys
accepted lists; `usage.json` records the sample provenance and policy. These are
bounded public deck samples, not a claim about all games or tournament strength.
Protection bosses frequently fail the generic-staple gate, so selection uses the
underlying accepted lists rather than only that gate's admitted suggestions.

Each card counts once per deck across Main, Extra and Side. Candidates must have
a printed protection effect and a corresponding stock script effect code for
battle destruction, effect destruction, effect targeting or immunity. Review
also includes attack targeting on a selected card. They must lack stock
**card-level** client hints. Rank by total deck appearances, then descending
passcode for ties. Selene's battle attack-selection restriction is outside these
protection categories. All selected stock official scripts were checked against
the current pinned upstream revision and manually reviewed for existing hints;
Gymir already has a player hint, which remains unchanged.

| Card / passcode | TCG | Domain | Genesys | Live protection described |
| --- | ---: | ---: | ---: | --- |
| Magician of Dark Chaos - Black Chaos / 44001993 | 23 | 1 | 0 | Self: opponent's activated effects except targeting effects. Own Spells/Traps: opponent's effect destruction. |
| Red-Eyes Dark Dragoon / 37818794 | 19 | 5 | 0 | Effect targeting and effect destruction. |
| Black Chaos / 98684220 | 22 | 1 | 0 | Opponent's activated effects while a Ritual Spell is in its controller's GY. |
| Vidolium the Unstable Power Patron of Unity / 70488851 | 23 | 0 | 0 | Monster effects except Power Patron monsters. |
| Medicurius the Power Patron of Illusions / 4063756 | 21 | 0 | 0 | Opponent's activated effects while linked to at least two monsters. |
| Angelechy Bastion / 28904860 | 14 | 0 | 5 | Other Angelechy cards: destruction by the source controller's opponent, while Bastion is in the Spell/Trap Zone. |
| The Winged Dragon of Ra - Sphere Mode / 10000080 | 4 | 1 | 14 | Attack targeting and opponent's effect targeting. |
| Black Luster Soldier - Soldier of Light and Darkness / 70405001 | 17 | 0 | 0 | Battle destruction; opponent's activated effects except targeting effects. |
| Psychic End Punisher / 60465049 | 12 | 1 | 3 | Opponent's activated effects when Synchro Summoned and its live LP condition holds. Multiplayer retains its existing all-opponent comparison. |
| Centur-Ion Legatia / 15982593 | 12 | 1 | 3 | Own monsters with at most 2000 ATK: battle destruction. The source is not automatically a protected recipient. |
| Number 90: Galaxy-Eyes Photon Lord / 8165596 | 15 | 1 | 0 | Effect destruction while it has a Photon material. |
| Underworld Goddess of the Closed World / 98127546 | 8 | 5 | 0 | Opponent's activated effects except targeting effects. |
| Dogmatika Ecclesia, the Virtuous / 60303688 | 9 | 2 | 1 | Battle destruction against monsters Special Summoned from the Extra Deck; the hint retains this opponent restriction. |
| The Dragon that Devours the Dogma / 76666602 | 8 | 2 | 0 | Other cards' effects while its stock Ecclesia condition holds. |
| Icejade Gymir Aegirine / 86682165 | 1 | 1 | 5 | Own monsters: opponent's effect destruction after its quick effect resolves, until the End Phase. |
| Rciela, Sinister Soul of the White Forest / 77313225 | 1 | 5 | 1 | Own Illusion/Spellcaster Synchro Monsters: opponent's effect destruction. |
| Mudragon of the Swamp / 54757758 | 4 | 0 | 3 | Self and monsters with its current Attribute on either field: targeting by effects other than those of Mudragon's controller. |
| El Shaddoll Winda / 94977269 | 1 | 5 | 0 | Opponent's effect destruction. |
| Max Metalmorph / 89812483 | 0 | 4 | 2 | Equipped monster: monster/Spell effect destruction and opponent's monster/Spell targeting. |
| Elemental HERO Shining Neos Wingman / 56733747 | 0 | 3 | 3 | Effect destruction. |

Counts can be reproduced using Python's `json`, `sqlite3` and `collections`:
read every deck from `decks.json`, count the set of its three card arrays, join
passcodes to the engine CDB's `texts` and `datas`, and inspect each candidate's
official script for `EFFECT_INDESTRUCTABLE_BATTLE`,
`EFFECT_INDESTRUCTABLE_EFFECT`, `EFFECT_CANNOT_BE_EFFECT_TARGET` or
`EFFECT_IMMUNE_EFFECT`. Combine alternate-art aliases before counting; Winda's
TCG appearance uses its alternate artwork 94977270. The remaining selected counts
are unchanged.
Exclude stock card-level hints, and sort by `(total, passcode)` descending. The
six-appearance tie admits Winda, Max Metalmorph and Shining Neos Wingman before
the lower-passcode Apkallone, Flare Metal Dragon and Red-Eyes Black Dragon Exceed.

Banishment restrictions on Magician of Dark Chaos and Gymir are existing
player-target effects. This addition covers the inspector's battle, destruction,
targeting and immunity categories; those player restrictions and Gymir's stock
player hint retain their existing behavior.

## Implementation and delivery

`packages/duel-server/card-script-patches/MANIFEST.json` pins the upstream SHA-256
of every appended script, including `utility.lua`. The pin is
[ProjectIgnis/CardScripts 5caccbf54d7d27b5208bef3b7bf49936eafc203c](https://github.com/ProjectIgnis/CardScripts/tree/5caccbf54d7d27b5208bef3b7bf49936eafc203c).
Every selected official script matches the owner-provided installed data and
that pin byte-for-byte. The utility fixture is the exact pinned stock helper.

The utility suffix registers one global `EVENT_ADJUST` observer when a selected
script loads. It scans public face-up field cards, obtains the core's applicable
effects with `Card.IsHasEffect`, and matches the effect owner's original code.
This accounts for conditions, field targets, equipment, negation, immunity and
temporary-effect expiration. It attaches or resets inert client-hint flags on
the **recipient**. Flags change only when the set of applicable descriptions
changes, and standard event resets remove them on departure or face-down resets.
The existing multiplayer seat helper includes every field, including the Tag
partner. Close alternate artwork aliases resolve through the core's original
code in the same way as script loading.

The core emits `CHINT_DESC_ADD` / `CHINT_DESC_REMOVE` (6 / 7) when those flags
are added or removed. Directly adding `EFFECT_FLAG_CLIENT_HINT` to a conditional
continuous protection would describe registration rather than live availability,
so the observer is necessary. Its flags do not cause additional readjust loops.
Descriptors are emitted in numeric order for deterministic reconstruction.

Accurate existing system strings remain in use. IDs `0x70000001` through
`0x70000008` resolve through `HOST_CARD_HINT_DESCRIPTIONS` for exceptions absent
from `strings.conf`. Bastion and Mudragon explicitly qualify the source
controller because their recipients can be on either side. The database lookup
checks host descriptors before interpreting card passcodes or packed string IDs.

The existing shared preparation path installs these suffixes into `card-scripts`,
so legacy Standard/Domain, pinned Standard/Domain and multiplayer use them.
Multiplayer suffixes are appended afterward and keep their existing rules.
No duplicate protection entries are needed in `multi-scripts/MANIFEST.json`.
Preparation replaces old host suffixes rather than stacking them, checks stock
hashes before applying changes, and writes the patch receipt. The hash of the
effective patched files contributes to `integrity.cardScriptPatches` and the
bundle identity pinned by games/replays. The deployment installer validates the
same receipt and now permits `utility.lua` alongside the prior helper/card files.
The engine-data updater already checks each patch's exact `stockPath`, so a
changed shared helper blocks automatic pin advancement for review.

## Verification

`tests/protection-hints-real.test.ts` stages private copies of patched files and
read-only links to the remaining owner resources. The owner-provided
`data/duel-engine` is historical: its utility/constants differ from the current
pins. Existing stock compatibility fixtures and the pinned utility fixture are
used only in the staged test tree. The original data is never written.

Real duels cover all 20 cards across legacy, pinned and multiplayer engines in
both Standard and Domain. They verify exact core hints, live negation and
restoration, LP and Synchro conditions, Photon-material removal, field recipients,
face-down resets, alternate artwork, actual Gymir resolution/End Phase expiration,
and actual Max Metalmorph resolution/equipping. No new pure unit tests were added.
The initial Dragoon scenarios failed with no hints before the suffixes were added.
The existing installer integration fixture now includes the patched utility.

Final targeted verification on 2026-10-23: all 156 protection engine checks passed
with no skips; all 44 existing installer integration checks passed. The server
TypeScript check also passed.

The historical multiplayer binaries lack `Duel.MPGetLP` required by the current
repo's pre-existing Psychic End Punisher overlay (patch 0119). Verification uses
newer cores composed with this checkout's current multiplayer scripts. The
initial run read them from `chicken-game-ffa`; final verification copied identical
reproducible builds read-only from `lp-diff-cards` into this worktree's ignored
temporary test directory before that other workspace could remove its output:

- `.../lp-diff-cards/packages/duel-server/domain-core/dist/ocgcore.multi.sync.wasm`
  SHA-256 `7ff1105acdb9301dad8f3c0001fad242377f67abe3ee29f971ecaedb4034b13b`.
- `.../lp-diff-cards/packages/duel-server/domain-core/dist/ocgcore.multi-domain.sync.wasm`
  SHA-256 `d3d7486b68568e4085e5c6ab31251a93b87abe29a8216eadc2b49f5dbc9e2711`.

Both copied binaries passed a live `Duel.MPGetLP` capability probe. Temporary
copies are removed after verification; they are not permanent project artifacts.
For a rerun, build compatible `multi` and `multi-domain` cores from this checkout
using the pinned toolchain documented in `domain-core/patches/README.md`. Run from
`packages/duel-server`, with Node 22.23.3 first in `PATH`:

```bash
DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 \
DUEL_DATA_DIR=/home/sulman633/repos/yugioh-bot/data/duel-engine \
MULTI_WASM="$PWD/domain-core/dist/ocgcore.multi.sync.wasm" \
DOMAIN_MULTI_WASM="$PWD/domain-core/dist/ocgcore.multi-domain.sync.wasm" \
npx vitest run tests/protection-hints-real.test.ts tests/install-engine-bundle.test.ts --testTimeout=15000
```
