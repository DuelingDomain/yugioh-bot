# Battle calculation projection and presentation

Goal: carry the engine's temporary damage-calculation stats through to battle playback, without changing the live board or card rules.

Architecture: project MSG_BATTLE as a public `battle` event with attacker/target stats and zones. BattleFx displays those values for the corresponding resolved fight; DAMAGE_STEP_END provides explicit completion for fights with no damage or destruction. Board queries remain the source of current position and stats; damage and destruction remain engine events.

- [x] Replay recorded seeds and accepted answers, checking prompt IDs/revisions.
- [x] Verify bundled card IDs/text/scripts and compare Standard/Domain cores.
- [x] Write a failing real-engine test for missing calculation stats.
- [x] Preserve MSG_BATTLE, including the direct-attack sentinel and an explicit Damage Step end.
- [x] Test/show calculation stats in battle playback, with dedicated FX-lab scenes.
- [x] Cover Enemy Controller position for both seats/spectators and web orientation.
- [x] Run full validation and register the isolated FX-lab scenes after the other worker commits the catalog.

Investigation: the root DB has no duel tables; the service's configured DB is `.worktrees/domain-multiplayer/data/bot.sqlite` (read only). Duel 62 (`69poo575`, 51 commands) is the latest played game and contains neither reported card. Duel 29 (`05vj1y64`, 107 commands) fully replays Enemy Controller at command 18: Beckoned by the World Chalice changes from position 1 to 4. No stored seat deck or public final snapshot contains Cat's Ear Tribe. Its historical battle cannot be verified from these rows.

Bundled Cat's Ear Tribe is 95841282 (Enemy Controller: 98045062). The bundled text/script applies 200 base ATK during the opponent's Damage Step, not only damage calculation. Both actual cores produce equal 200 ATK and mutual destruction with no LP loss for an unboosted Gemini Elf; Axe of Despair leaves it at 1200 during calculation, causes 1000 damage, and restores 2900 afterward. Server projection currently discards those MSG_BATTLE stats. Current Enemy Controller position projection and Chromium quarter-turn rendering already work; add coverage rather than infer an engine bug.

Review caught and fixed an interim playback timing issue: MSG_BATTLE can precede an after-calculation D.D. Warrior Lady prompt. Regression tests retain the pending fight until actual destruction or Damage Step end; battle casualty MOVE events no longer conceal their later destroy events.
