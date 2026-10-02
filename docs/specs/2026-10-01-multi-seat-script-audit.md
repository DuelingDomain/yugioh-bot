# Multi-seat script audit

Date: 2026-10-01. Core: installed P61. The overlay loads only for more than two seats.

## Owner field returns

Gimmick Puppet Fiendish Knight (4145915) and Centur-Ion Phalanx (40155014) used a folded owner value to select the return field. In FFA3, FFA4 and Tag, a target of a later opponent went to seat 1. Fiendish Knight also checked summon legality against that wrong seat. The overlay now binds the real owner for the check and the target summon. Fiendish Knight then summons itself in the original scope. A banished or Graveyard card has its owner as its controller, so MPForEachController gives the owner seat.

Live proof: `tests/scenarios/multiplayer/owner-field-returns.ts`. The 16 cases include both Tag teams and return to a partner. Each case checks every seat. The original scripts fail; the fixed scripts pass. The two-card baseline probe also checks the actual wrong return to seat 1 in all three formats.

## Baseline fuzz

Seeds 1 to 100, Standard, default 1000 steps: FFA3 100/100, FFA4 100/100, Tag 100/100. No error, hang or budget stop. Steps: 34912, 49381, 33507.

Seeds 1 to 50, Domain, default 1000 steps: FFA3 50/50, FFA4 50/50, Tag 50/50. No error, hang or budget stop. Steps: 16615, 24417, 15844.

## Each duelist summons

The Shallow Grave (43434803), The Grave of Enkindling (84136000) and Different Dimension Encounter (39900763) skipped the Tag partner. An own-side Graveyard query also allowed the activator to select a partner card as its own choice. Each living duelist now selects and summons in its own scope. The query checks the real seat of the card. The summon completes once after all seats act. The PLAYER_ALL group-size guards stay in place.

Live proof: `tests/scenarios/multiplayer/each-duelist-revival.ts`. The 12 new cases cover FFA3, FFA4 and both Tag teams. Each case checks the prompts and every seat. The original overlays fail all six Tag cases. The fixed cases and six existing cases pass on each core.

## All hands

Neo-Daedalus (10485110) and The Law of the Normal (66926224) left the hands of unpicked opponents unchanged. Norleras (48453776) and Sophia (4335427) included all FFA hands while unbound, but missed the Tag partner hand. Each overlay collects the cards of every living duelist before one simultaneous send or banish action. The target information uses that exact group.

Live proof: `tests/scenarios/multiplayer/all-player-zones.ts`. The 20 cases check every seat, include 1v1 controls and skip an eliminated FFA4 seat. The stock three-format probe fails eight of 12 outcomes; the fixed 20 cases pass on each core.

## All Decks

Nobleman of Extermination (17449108), Nobleman of Crossout (71044499) and Inferno Tempest (14391920) missed later Decks after a scoped query. Crossout failed in Tag; the other two failed in all three formats. Each overlay now collects each living duelist's Deck before the action. The Noblemen reveal the collected Decks to each duelist and shuffle each Deck.

Live proof: `tests/scenarios/multiplayer/all-player-decks.ts`. Seven of 12 stock cases fail. All 12 fixed cases, including 1v1 controls, pass on Standard and Domain.

## Global player state

Clear World (33900648) registered EARTH, WATER and FIRE effects only for raw seats 0 and 1. Its overlay adds each later living seat and reads Clear Wall by real opposing side. Battlewasp Hama (80949182) read a single damage flag tied to the first copy. Its overlay stores battle damage per FFA seat or Tag team.

Live proof: `clear-world-seats.ts` and `hama-damage-state.ts`. The original scripts fail 11 of 17 cases. The fixed scripts pass all 17 on each core. The existing global flag, R2 seat and attack count checks pass 147 cases on Standard.

## Damage to each side

Mecha-Dog Marron (94667532) damaged only folded players 0 and 1 after battle destruction. It now damages each living duelist once. Under Q3, each Tag member takes the stated damage, so each team loses 2000 LP. Live proof: `mecha-dog-marron.ts`. Both stock FFA outcomes fail and both Tag controls pass. All four fixed cases pass on each core.

## Returned owners discard

Criosphinx (18654201) represented returned monster owners with two bits. It now uses one bit per real seat. Each owner in the return event discards once, including a Tag partner. Live proof: `criosphinx.ts`. All six stock outcomes fail; all six fixed outcomes pass on each core.

## Target controller and owner actions

Mecha Bunny (10110717) damaged a picked opponent instead of the actual target controller. Mimighoul Fork (19338434) gave two draws to a picked opponent instead of the sent card's owner. These overlays bind the target controller for damage and the controller of the Graveyard card for the owner's draw. Fork keeps the opponent's effect choice. Live proof: `owner-actions.ts`. The stock probe fails five of six outcomes; the fixed six cases pass on each core.

The first Marron fix used one damage action per Tag team. The Q3 rule requires each living duelist. The corrected Tag scenarios fail that first fix (expected 14000, got 15000) and pass 4/4 on each core.

## Global owner events

Iron Core Specimen Lab (53039326) raised upkeep events only for owners 0 and 1. The global callback now puts each real owner in its own event. Live proof: `iron-core-owner.ts`. Three later-owner stock outcomes fail; three seat-1 controls pass. All six fixed cases pass on both cores.

## Black Dragon Ninja returns

Black Dragon Ninja (56562619) returned a later owner's banished monster to the picked opponent. The overlay groups the banished cards by their real owners, checks each return field and completes the summons once. The Blue-Eyes Spirit limit stays in place. Live proof: `black-dragon-return.ts`. The stock wrong-field probe fails in all three formats. All three fixed cases pass on both cores.

## Union controller returns

Combination Attack (8964854) summoned an opposing Union Monster to a picked opponent instead of its controller. Its target checks and summon now bind the actual controller. Live proof: `combination-controller.ts`. The stock FFA probes return Y-Dragon Head to the wrong field; the three fixed cases pass on both cores.

## Hydor owner field

Hydor (30339825) offered WATER monsters from other FFA owners as its destruction choice. Its filter and operation now bind the Graveyard target's real owner and restrict the FFA field query to that seat. The Tag query retains the joined own team field. Live proof: `hydor-owner.ts`. The original FFA3/FFA4 choice probes show an extra wrong-owner monster. All four fixed outcomes pass on both cores.

## More all-duelist zones

Mischief of the Gnomes (164710), Underworld Circle (73443672), The Bystial Alba Los (69120785), Card Destruction (72892473) and Hand Destruction (74519184) skipped later or partner hands, Decks, Extra Decks or Standby summons. Their overlays now collect or visit each living duelist. Card Destruction and Hand Destruction keep their FFA ban and use the change only in Tag.

Live proof: `all-player-zone-gaps.ts` and `underworld-circle-standby.ts`. Seven of 11 stock zone probes fail. All three stock multiplayer Standby probes fail. The 16 fixed zone cases and four fixed Standby cases pass on both cores; 1v1 controls keep the stock scripts.
