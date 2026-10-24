# Local PR review scenarios

Open [Sandbox](http://localhost:3000/sandbox) while signed in as Discord owner `196382407044235264`. The fixtures start with **Local PR review |**. Every rival is **Manual**, every seat has an explicit 40-card Normal Monster deck, and the seed is fixed. Existing `/sandbox/1` through `/sandbox/4` are preserved.

In each fixture choose **Play**, answer **Continue this phase** if shown, enable **Follow prompt** and **Reveal hands**, and use the sandbox **P0–P3** chips to act for any seat. Pass unrelated response windows. **Restart** restores the saved board and seed. The bar uses zero-based `P0–P3`; a card's “LP opponent: Player N” label uses one-based numbering (`P1` is “Player 2”).

These links were seeded on the local stack on 2026-10-23. The seeder preserves their IDs on reruns.

| Scenario | Local URL |
| --- | --- |
| Chicken Game FFA4 mixed LP protection #458 | http://localhost:3000/sandbox/11 |
| Dark Doriado non-inverse topdeck order #457 | http://localhost:3000/sandbox/12 |
| Honest Auto Damage Step #455 | http://localhost:3000/sandbox/13 |
| Tarantula FFA4 summon opponent choice #464 | http://localhost:3000/sandbox/14 |
| Tarantula FFA4 remembered-opponent burn #464 | http://localhost:3000/sandbox/15 |
| Myriaday FFA4 chosen LP counters #464 | http://localhost:3000/sandbox/16 |
| Coordius FFA4 destruction and post-cost ATK #464 | http://localhost:3000/sandbox/17 |
| Pig Iron FFA4 equal-LP opponents #464 | http://localhost:3000/sandbox/18 |
| Tsukumo Slash FFA4 actual defender LP #464 | http://localhost:3000/sandbox/19 |
| Honest FFA4 turned rival seat #460 | http://localhost:3000/sandbox/20 |
| Visible monster ATK DEF FFA3 #462 | http://localhost:3000/sandbox/21 |
| Visible monster ATK DEF FFA4 #462 | http://localhost:3000/sandbox/22 |
| Visible monster ATK DEF TAG #462 | http://localhost:3000/sandbox/23 |
| FFA4 eliminate to two and click movement #463 | http://localhost:3000/sandbox/24 |
| Card drawer pin chain and targets FFA4 #459 | http://localhost:3000/sandbox/25 |
| Card status protections counters equip FFA3 #465 | http://localhost:3000/sandbox/26 |
| Card status protections counters equip 1V1 #465 | http://localhost:3000/sandbox/27 |

## Checks

1. **Chicken Game:** The bar starts on P1's Battle Phase. LP are P0/P1/P2/P3 = **7000/8000/7000/1850**; Chicken Game belongs to P2. Use the first Red-Eyes Black Dragon to attack P0 directly: P0 must fall to **4600**. Use the second to attack P3: P3 stays **1850**. P0 being below P1 does not protect it; P3 being strictly below every living rival does. Do not activate Chicken Game's ignition effect.
2. **Doriado:** Normal Summon Dark Doriado, accept its trigger, and select **Silver Fang (EARTH), Harpie Lady (WIND), Aqua Madoor (WATER), Flame Manipulator (FIRE)** from the Deck. At the four-card ordering prompt, note the initially displayed cards as positions 1–4. Order them **4, 2, 1, 3** (zero-based `[3,1,0,2]`, whose inverse is `[2,1,3,0]`). Activate both Pot of Greed cards. The four selected monsters must enter the hand in the submitted top-to-bottom order. Do not use a reversal: it would conceal this regression.
3. **Honest #455:** Set P1's response switch to **Auto**, retain Follow prompt, and attack P1's Alexandrite Dragon with P0's Blue-Eyes. P1 must receive the optional Honest activation in the **Damage Step** despite Auto. Activate it from hand: Honest goes to P1's GY, Alexandrite reaches **5000 ATK**, Blue-Eyes is destroyed, and P0 ends at **6000 LP**. Restart and repeat with **Always**; **Off** is a negative control that passes the optional effect.
4. **Tarantula summon:** Xyz Summon Ravenous Tarantula using Night Express Knight and Super Express Bullet Train. Choose **P1** as its LP opponent. It has two materials and **2000 ATK/DEF**; inspect it for **LP opponent: Player 2**. Activate its detach effect: detach a material and destroy P1's Battle Ox. P2's Celtic Guardian survives. Restart and choose P2 instead to see **5000 ATK/DEF**.
5. **Tarantula burn:** Answer Tarantula's initial opponent choice as P0 and choose **P1**. Walk to P1's Main 1 using **Next turn**, answering any windows that stop the walk. Special Summon P1's Cyber Dragon from hand. Tarantula's mandatory effect burns **P1 for 600** (7000 → **6400**), and its ATK/DEF become **1400**. Walk to P2's Main 1 and Special Summon P2's Cyber Dragon. P2 remains **10000**, P1 remains **6400**, and the remembered opponent remains P1. Keep the Xyz material attached for this check.
6. **Myriaday:** Activate Myriaday Dragon's Main Phase effect as P0; choose **P2**. The absolute 5000 LP difference grants **five Myriaday counters**. Restart and choose P1 for **two**. Its temporary LP-opponent hint ends with counter resolution.
7. **Coordius:** Activate Polymerization; use Stardust Dragon, Number 39: Utopia and Link Spider. Activate the newly Fusion Summoned Coordius, choose **P1**, pay **4000 LP**, and select **Destroy** plus **ATK**. Destroy P1's three monsters; all three P2 monsters survive. P0 is **16000 LP**, so the post-cost difference from P1's 22000 is 6000: Coordius becomes **6000 ATK**, with **LP opponent: Player 2**. End the turn: it resets to **3000 ATK**.
8. **Pig Iron:** Activate Pig Iron vs. Pen Peg's GY Set effect. Only the equal-LP rivals **P1/P2** are legal choices; the richer P3 is excluded. Choose P2: the card leaves the GY and Sets in P0's Spell/Trap Zone. Restart, eliminate P1 through the bar, and confirm P2 still qualifies.
9. **Tsukumo Slash:** Attack P1's Blue-Eyes using P0's Battle Ox, then activate the Set Tsukumo Slash at the legal battle window. It uses **P1's 7000 LP**, adding **2000 ATK** to Battle Ox for **3700**. Blue-Eyes is destroyed and P1 falls to **6300**. The 10000/12000-LP bystanders must not determine the bonus.
10. **Turned rival Honest #460:** As P0, attack **P2's face-up attack-position Mystical Elf** using Axe Raider. Follow prompt switches to P2; activate P2's Honest by clicking its hand card in the turned rival seat. The selection/action anchor must remain usable. Honest reaches P2's GY, Elf reaches **2500 ATK**, Axe Raider is destroyed, and P0 falls to **7200 LP**. P3 also holds Honest and a LIGHT Elf, but cannot activate it in this unrelated battle.
11. **ATK/DEF #462:** Open each of FFA3, FFA4 and Tag. All face-up monsters must show both values, including defense-position cards and rotated rival seats. Expected ATK/DEF: P0 Battle Ox **1700/1000**, Mystical Elf **800/2000**; P1 Blue-Eyes **3000/2500**, Celtic Guardian **1400/1200**; P2 Axe Raider **1700/1150**, Giant Soldier of Stone **1300/2000**; P3 (FFA4/Tag) Red-Eyes **2400/2000**, Beaver Warrior **1200/1500**. Switch acting seats and resize the window to check readable labels and working clicks.
12. **Four to two #463:** Start as P0 in Main 1. Open the caret next to **P1**, choose **Eliminate…**, then confirm **Eliminate**. Repeat for **P3**. P0/P2 remain in their original seat numbers. Click P0's Battle Ox in hand, choose Normal Summon and a free zone; check its movement lands and later clicks select the visible card. Enter Battle Phase, click P0's Axe Raider, attack P2's Blue-Eyes and finish the battle. Walk to P2's next Main 1 and change Blue-Eyes to Defense Position; click it again after rotation/movement and inspect it. Both surviving seats must retain correct card hit areas. The bar disallows eliminating the current turn player or leaving fewer than two survivors.
13. **Card drawer pin #459:** Use FFA4 at a laptop size (1366×768), then repeat at a narrow phone size. Pass opening response windows to reach Main 1. Click a face-up card to pin its drawer and move the pointer away. As P0 activate **Pot of Greed**. At P1's response window, activate the Set **Raigeki Break**, discard its Mystical Elf if asked, and target P0's **Axe Raider**. Keep a card pinned while those panels and targets are open; the drawer must move aside or tuck, with a **Pinned** handle when tucked. The handle opens/closes the retained pin without answering the prompt. Pass remaining windows: Axe Raider is destroyed and Pot draws two. As P0 activate **Mystical Space Typhoon** and choose between P2's and P3's Set cards; select P2's **Supply Squad**. Target hit areas and LP/name plates must remain clear. Right-click inside an open pinned drawer: the drawer and handle close, while an unanswered prompt stays open. Restart to repeat either sequence. Clicking another card changes the pin; hover only temporarily shows that card. P0's Battle Ox also offers a simple Normal Summon zone-pick check.
14. **Card status #465:** Run the same steps in FFA3 and 1v1. These boards save the starting setup; equip links, negation and counters are created by normal engine actions. The opening draw already gives **Shard of Greed one Greed Counter**. P1's **Red-Eyes Dark Dragoon** should immediately show targeting/destruction protection hints. As P0:
    - Normal Summon **Metaltron XII, the True Dracombatant**, tributing **Mystical Elf**, **Supply Squad** and **Call of the Haunted**. Inspect it for separate Monster, Spell and Trap immunity hints.
    - Activate **Myriaday Dragon**. In FFA3 choose **P1** (the 8000-LP rival); 1v1 has no opponent-choice prompt. The 5000/8000 LP difference gives **three Myriad Counters**, using a generic family glyph.
    - Activate **Axe of Despair**, place it in a free Spell/Trap Zone, and target **Number 39: Utopia**. Utopia must show **3500 ATK**, its equip chip and **two Xyz materials**. **Magical Citadel of Endymion** receives a Spell Counter.
    - Activate **Pot of Greed**. In P1's response window activate **Effect Veiler**, targeting P0's **Toy Soldier**. Pass other responses, including Dragoon's optional negation. Toy Soldier shows **negated** until the turn ends; Citadel now has **two Spell Counters**, Shard still has **one Greed Counter**, and Myriaday still has **three Myriad Counters**.
    - Hover/pin each card and compare the named status list with the board glyphs. Check rotated rivals and a narrow window: counters, protection rails, ATK/DEF, equip chips and material counts stay readable, and cards remain clickable. Restart restores the initial setup.

## Timer #456: use a regular timed duel

Sandbox explicitly forces `turnSeconds: 0` and creates no decision clock. Board/run JSON cannot override it, so none of these fixtures can verify #456.

Open [Create duel](http://localhost:3000/duels/new). Choose **Standard**, **1v1**, **Unranked**, a **1 minute per turn** Turn timer, and **Play on** for “When the timer runs out.” Create an invite-only table, load real playable decks, and join the other seat from a second signed-in local account/browser profile. Both players must finish ready/opening choices; a practice bot answers too quickly for the response-wait check.

Once Main 1 is waiting for Player A, leave both windows untouched for five seconds: only A's displayed bank should decrease. Have A take a legal action that opens a response window for B (B can choose **Always** beforehand so a response window remains visible). While B leaves that decision unanswered for five seconds, only B's bank should decrease, even though the turn still belongs to A. Pass as B and check that the bank follows the next player who must answer. During engine work and presentation animations no bank should run; wait until the visible decision appears before timing. Reconnecting or viewing the room must not restart either bank. The creator's timer wording describes the bank size; it is a decision clock with action credit, not a continuously running turn countdown.

## Seed or validate locally

Run from this checkout with Node 22. Supply the runtime service's **existing** absolute database path explicitly and the local copied engine bundle. If sourcing the local service environment, keep it private and do not echo it. The seeder does not load `.env` or infer a database from the working directory.

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
export DUEL_DATA_DIR="$PWD/data/engine-local-ready"
node --conditions=source --import tsx scripts/local-ready-pr-scenarios.ts --validate

# Supply the exact DATABASE_PATH already used by the local services:
NODE_ENV=development DATABASE_PATH=/absolute/path/to/runtime/bot.sqlite \
  node --conditions=source --import tsx scripts/local-ready-pr-scenarios.ts
```

`--validate` resolves every referenced card against `cards.cdb` and compiles every board without opening the application DB or starting a duel. It does not prove that a complete manual interaction succeeds. The normal run resolves `users.discord_user_id` to the existing application `players.id`, requires an unambiguous guild (set `DISCORD_GUILD_ID` if needed), and uses `createSandboxScenarioService` in one transaction. It creates no users or players, performs no migrations, refuses `NODE_ENV=production`, and updates only exact prefixed names belonging to that player. Unchanged fixtures keep their IDs and timestamps. Duplicate names or a collision with protected IDs 1–4 abort the transaction.

The boards cover Standard mode with the installed multiplayer bundle. Tag uses four separate fields with shared team LP (P0/P2 and P1/P3). These fixtures do not replace Domain, historical replay or eliminated-opponent fallback engine regressions.

## Local verification on 2026-10-23

All 14 saved boards started on real engines. The PR engine suite passed 419 cases; the native golden check passed 80 rows with zero mismatches. Shared sandbox, host controls, account history, web sandbox/fork, timer and bug-report checks passed. All 40 web Damage Step integration cases ran with real cores.

Next 16.4.1 Turbopack failed while resolving its generated Schibsted Grotesk font query, including after a clean build. The deployed build succeeded with `npx next build --webpack` followed by `npm run package:standalone` in `packages/web`, after privately sourcing the required build environment. Bug-report integration needed `--testTimeout=15000` while the build was busy; all 18 cases then passed without source changes.

The three local services use the copied engine bundle at `data/engine-local-ready`. The web unit serves the standalone copy in `../web-live`. A live FFA4 start, rival-seat response mode and Reveal hands passed after restart. Sign-in and all three multiplayer previews rendered in Chromium with no page errors. Engine `.build` folders and unused local web/core build output were removed after installation. The Docker bot stayed stopped.

## Drawer and status integration on 2026-10-23–24

PR #459 was merged at `c7c0e743c`. After polling, the fetched #465 head `ff36932dd` passed `git merge-base --is-ancestor b5da75c49 origin/feat/card-status-counters`; its local merge is `4575a5828`. Nothing was pushed.

Conflicts were resolved in the room, engine imports, inspector and browser tests. The result keeps sandbox seat controls, both LP-opponent and card-status hints, and both motion-guard and status browser cases. The inspector keeps the LP-opponent line and uses the new status list for negation/counters. Local host rules are uniquely numbered `duel-rules-10`.

The npm wrapper was restored cleanly, then the repository patch was applied with `patch-package`. `duel:prepare` installed protection helpers and script suffixes into `data/engine-local-ready`; bundle verification passed. Both multiplayer cores were rebuilt with the pinned toolchain and installed with build metadata, capability receipts and checksum sidecars. The merged PRs leave those core inputs unchanged. All 80 native golden rows were recorded locally and checked with zero skips or mismatches.

Validation passed 594 server status/sandbox cases (one additional case skipped), 78 timing/sort replay cases, 175 shared sandbox cases, 116 web cases and 45 real-engine web cases. All 17 saved scenarios started through a real host. Both new status setups completed their documented actions, asserting immunity hints, exactly 2 Spell / 1 Greed / 3 Myriad counters, Veiler negation, the equip relationship, 3500 ATK and two Xyz materials. New saved scenarios 25–27 also started through the restarted service; Dragoon protection hints and the opening Greed Counter were checked there.

Browser validation caught a real target-pick bug: a pinned drawer could avoid the legal targets while covering LP plates on the opposite side. The new regression failed on LP plates 0/1 before the fix. Placement now requires a valid LP/name-plate fit as well as clear targets; if neither side fits, it tucks with the Pinned handle. Review approved the fix. The regression and all three status-pin cases passed on the rebuilt deployment. The status layout run passed 23 cases initially; the remaining case had a trace-artifact cleanup collision and passed in the isolated final rerun. Across those runs, all 25 distinct status/drawer browser cases passed. Sign-in and FFA3/FFA4/Tag preview pages rendered without page errors.

Test harness failures were corrected locally: the broad engine npm script selected optional unbuilt test cores, source-only loader conditions did not propagate correctly to compiled resource workers, and concurrent Playwright runs shared an artifact folder. Targeted commands, compiled worker imports and separate output folders resolved these issues. The standalone web build used webpack, matching the earlier documented workaround.

Additional drawer previews passed at 1366×768 (Main, chain, target pick) and 390×844 (chain, target pick): prompt hit areas stayed clear, tucked pins exposed a working Pinned handle, and right-click closed the drawer. The phone checks removed the preview-only toolbar and Elimination control, then waited for board movement to settle; those fixture controls are absent from the live room. These preview checks complement the real-engine fixture actions and signed live-service starts.

The final standalone copy is installed in `web-live`; all three named user units are active, `/sign-in` returns 200, and new saved duels still start after cleanup. New service logs show no runtime errors. Unused `.next`/core output and every engine `.build` folder were removed. Shared, duel-server and ws runtime output and the copied engine bundle remain installed. The Docker bot stayed stopped; there were no pushes.
