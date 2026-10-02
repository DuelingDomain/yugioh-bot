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

## The holder's own turn

Dark Snake Syndrome (47233801) and Crimson Nova (30270176) also triggered on the Tag partner's turn. Their conditions now use MPTurnOwns for the holder. Their damage still acts once per living duelist, as Q3 requires. Live proof: `each-player-lp-simple.ts` and `each-player-lp-triggers.ts`. Four original Tag cases show extra damage. The 84 cases for 21 each-player LP cards pass on both cores.

## Extra Deck and Deck top

Clown Crew Cappello (19491080), Destiny HERO - Dark Angel (26964762) and Alba System Dogmatikalamity (93053159) changed only some Extra Decks or Deck tops after a bind. Their overlays include each living duelist. Live proof: `all-player-extra.ts`. The real Tribute Summon, Standby cost and Fusion/ignition probes fail in all three multiplayer formats. All 12 fixed cases pass on both cores, with 1v1 controls.

## Fork draw eligibility

Mimighoul Fork (19338434) could offer a two-card draw when the real owner's Deck was empty. The picked chooser's Deck had two cards, so the folded owner check passed. Its filter and operation now rebind each FFA duelist to find the exact owner. In Tag, they bind the current controller for an unchanged owner/controller. Live proof: `fork-draw-legality.ts`. All three previous-overlay probes offered the wrong option; nine fixed legality and owner-action cases pass on both cores.

Tag cards owned by a different duelist still need the real-owner API, including a transfer between partners whose folded owner/controller values are equal. That complete fix is exported with the core query and is not installed.

## Pin Baller LP compare

Gold Pride - Pin Baller (28497830) used folded players in a global protection callback. After Solemn Strike paid its cost, the callback could compare a number with nil for a later seat. Its overlay stores the real own and picked-opponent keys when the target is set, then reads current LP with those keys. Live proof: `pin-baller-lp.ts`. All six stock cases fail with the Lua error. All six fixed cases pass on both cores, for lower and higher LP after the cost.

## Lucky Cloud state

Lucky Cloud (82760689) mixed Cloudian summon names from different FFA seats. It now stores a separate group and repeat flag for each seat or Tag team. Live proof: `lucky-cloud-state.ts`. Three stock cross-seat cases draw wrongly; four own and Tag-partner controls pass. All seven fixed cases pass on both cores.

## Pair Bear recovery

Pair Bear Scare!! (21501961) recovered LP for only two folded players. It now recovers 2000 LP for each living duelist. One picked opponent still reveals a copy and decides the branch. Live proof: `each-player-lp-responses.ts`. All four stock recovery outcomes fail. The 28 response cases and 12 variable-amount cases pass on both cores. Each Tag pool gains 4000 LP under Q3.

## Chaos Emperor Tag hands

Chaos Emperor Dragon (82301904) left the Tag partner's hand unchanged. The Tag-only overlay sends the union of every duelist's hand and field. Its stock damage calculation stays in place. The FFA ban stays. Live proof: `chaos-emperor-tag.ts`. The stock Tag outcome fails; the fixed Tag outcome and stock 1v1 control pass on both cores.

## Equip target damage

DoomZ Command (68831625) and Worm Millidith (71315423) used the equip target's folded controller during a phase event. A picked opponent could take the damage while the actual target controller took none. The overlays bind that controller for target information and damage. Live proof: `doomz-controller.ts` and `worm-controller.ts`. Four stock FFA outcomes fail; two Tag shared-LP controls pass. All six fixed cases pass on both cores.

## Cheatah control return

Fallin' Cheatah (59011257) changed control to a picked opponent after its custom summon event, even when another opponent summoned the target. Its check and operation now bind the summoned target's real controller. Live proof: `cheatah-controller.ts`. All three stock outcomes show the wrong field. All three fixed outcomes pass on both cores.

## Delayed hand recipients

Gift Exchange (82257940) and PSY-Framelord Omega (74586817) returned cards to the picked opponent instead of the real hand controller. Their overlays keep the actual pair or hand seat through the delayed return. Live proof: `gift-exchange-pair.ts` and `omega-hand-return.ts`. All six stock outcomes fail. All six fixed cases pass on both cores.

## Damage after destruction

TA.I. Strike (86449372) and Arcana Force XV - The Fiend (59712426) used a folded controller after destruction. Their overlays keep the real controller before the card moves. Live proof: `tai-battle-controller.ts` and `arcana-target-controller.ts`. Six stock FFA outcomes fail; three Tag controls pass. All nine fixed cases pass on both cores. The TA.I. Strike tests include a monster whose owner and controller differ.

## Local target damage

Pestilence (62472614), Mask of Dispel (20765952), Mask of the Accursed (56948373), Darkworld Shackles (83584898) and Axe of Fools (19578592) damaged the wrong folded player and also triggered on the Tag partner's Standby Phase. Stamping Destruction (81385346) and Turbo Cannon (13574687) used the wrong folded target controller at resolution. Their overlays bind the actual controller. The five Standby effects also use MPTurnOwns.

Live proof: `local-controller-lp.ts`. The original scripts fail 24 cases. Twelve controls pass, including Ghost Mourner and Blazing Mirror Force. All 36 fixed cases pass on both cores.

## Greed shared field view

Greed (89405199) counted the same face-up Trap twice when it checked both Tag members' joined Spell and Trap zones. The draw callback now visits each observer card once. Live proof: `player-all-overlay-lp.ts`. Both original Tag outcomes fail, with 2000 damage instead of 1000. Both FFA controls pass. All 20 checks for five overlay LP cards pass on both cores.

## Unicore Tag hands

The Fabled Unicore (44155002) compared only the event opponent's hand in Tag. Q2 requires both opposing hands; the own hand remains the holder's hand. The Tag-only overlay sums both opposing hands. Live proof: `fabled-unicore-counts.ts`. Both stock Tag cases fail, in opposite directions. All five fixed cases pass on both cores, including stock 1v1 and FFA controls.
