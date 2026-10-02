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
