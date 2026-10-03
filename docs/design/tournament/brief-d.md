# Concept D: Solid Vision (letter d, files d.html / d.js / d.css)

**Idea.** A's idea, in a different world. In the anime, a duel is fought on a field of light that the duel disks project onto the ground. This page leads with **your next duel as that projected duel field**: you stand at the near edge, your opponent at the far edge, and the field between you is drawn in light. The field's zones are not empty decoration: **your row of five zones is your five rounds**, and theirs is their five rounds. A win is a gold locator card lying in that round's zone. The standings below show what everyone has collected.

**The world.** Cold, clean, competitive. A dark floor with the field drawn on it in thin lines of projected light. The light comes from the duel disks at each edge, so the glow sits low near each duelist and fades toward the centre (the opposite of A's lamp from above). Your half of the field is drawn in violet light (`--pen`), their half in their ring colour. Gold only for wins. No wood, no lamp cones, no grid-paper floor, no cyan.

Extra material colours you may add: `--floor:#050811` (the floor under the field) and `--beam: 198 182 255` (projected light, used as `rgb(var(--beam)/a)` for your side). For their side use their `ring` colour with opacity.

## Desktop 1440

```
+------------------------------------------------------------------------------------------+
| <  Cube cup 4                               Round 3 of 5      [Host tools]  [Animations] |
|    The duels. Round robin, best of 3.                                                    |
+--------------------------------------------------------------+---------------------------+
|   (Ke) Kestrel   Platinum 1402   2–0 tonight                  |  Tonight (rail, 340px)    |
|      ___________________________________________________     |  Live now                 |
|     / [deck]  [ r1 ][ r2 ][ r3 ][ r4 ][ r5 ]   (their row) \  |  Waiting to confirm       |
|    |            ---------  0 – 0   ○ ○ ○  ---------          | |  Results                  |
|    |              Round 3. Not started.                      | |  Rules                    |
|     \ [deck]  [ r1 ][ r2 ][ r3 ][ r4 ][ r5 ]   (your row)  /  |                           |
|      '-----------------------------------------------------'  |                           |
|   (Im) Imran  You   Gold 1186   1–1 tonight                   |                           |
|   +25 if you win    −7 if you lose                            |                           |
|   [ Start duel ]  [ Report a result ]                         |                           |
+--------------------------------------------------------------+                           |
|  Standings (locator strips)                                   |                           |
+--------------------------------------------------------------+---------------------------+
```

**The field (hero, about 540px tall).** Drawn at a perspective tilt (`rotateX` about 38deg, `transform-origin` bottom centre) so it reads as a floor seen from where you stand. Flat on phone.
- The outline: a rounded rectangle of 1px light lines (`rgb(var(--beam)/.55)` on your half, their ring colour at .55 on theirs) with a soft static glow made by a second blurred copy of the line at low opacity (static only; never animate filter or shadow). A centre line across the middle.
- Each half has a **deck zone** at the outer left: a card-sized zone with the face-down card back (`../assets/card-back-main-hd.webp`, a stack of 3 offset backs) and "Deck in" in `--ink-3` under it. "No deck yet": an empty dashed zone, and on your side a "Choose a deck" link.
- Each half has a **row of five round zones** (card-sized outlines, upright card proportion 59:86). Use the matches from data.js for that player, in round order:
  - **Won**: a gold locator card lying in the zone: `--chain` border, dark gold fill, a small star mark, and the monogram of the player they beat. Under the zone, tiny "Beat Ke".
  - **Lost**: the zone holds a face-down card back at 35% opacity. Under it "Lost to MM".
  - **This round (the match on the field now)**: the zone's outline is brighter and doubled, with the opponent's monogram faint inside. On Full it breathes slowly (opacity only).
  - **Not played yet**: an empty outline with the future opponent's monogram faint, and "R4".
  - **Waiting to confirm**: the locator card at 50% with a small clock mark.
  - **Bye** (single elimination): the zone holds the word "Bye" in `--ink-3`, no card.
- Centre of the field, on the centre line: the series score as big light numerals (`--f-display`, `--ink`, with a faint beam glow), "0 – 0", the three best-of-3 marks (hollow ring = not played, filled `--pen` = your game, filled in their ring colour = their game), and a line under it: "Round 3. Not started." / "Between games. Game 2 next." / "Game 3 in progress".
- Seats: outside the field, above the far edge and below the near edge: monogram ring (52px), name, "You" pill on yours, tier gem + tier + Elo, and the record tonight ("2–0 tonight").
- Under your seat: stakes ("+N if you win" in `--chain-ink`, "−N if you lose" in `--loss-ink`, from `TourData.stakes`), then "Start duel" (primary `--pen-fill`) and "Report a result" (outline in `--rule`).
- Ambient life (Full only): a very slow drift of the line glow's opacity, and the current round zone's breathing. Nothing else loops.

**Standings (under the field).** One row per player in `TourData.standings` order: rank number (`--f-display`, `--ink-3`), monogram (36px), name, tier gem + Elo, then the **locator strip**, then the record in `--f-num`.
- The strip is the same five round slots as the field, small (22x32), in round order, with the same marks (gold locator card with the beaten player's monogram, dim card back for a loss, faint outline for not played, breathing outline for live, 50% card with clock for waiting to confirm).
- The rows sit directly on the floor with `--rule-lo` lines between them, no cards or boxes. Your row has a `--pen-soft` underlay and "You" after your name.
- Hover or focus on a slot shows a tooltip: "Beat Marik_Mains 2–1", "Lost to Marik_Mains 1–2", "Playing duel.josh now", "Waiting for BlueEyesBen to confirm", "Plays Kestrel in round 4".

**Tonight rail (right).** Plain sections separated by `--rule-lo` lines, no boxes, exactly A's content: "Live now" (both monograms, game score, "Game 2 next"), "Waiting to confirm" ("voidpriest reported beating BlueEyesBen 2–1. BlueEyesBen has 23 hours to confirm."), "Results" (newest first, time in `--ink-3` then the line), "Rules" (definition list, then "Made from the draft Cube draft 4").

**Host tools.** A "Host tools" button in the top bar opens a right-side drawer: "Decks" (each player, "Deck in" / "No deck yet"), "End now" + its consequence line, "Cancel the tournament" + its consequence line (red outline buttons).

## The orchestrated moment: a locator card is projected and claimed

When "A result comes in" gives a `final` event:
1. On the rail's "Live now" line for that match, the score digits roll to the final value (translateY ticker).
2. A gold locator card is projected into being at that line: it starts as a thin bright horizontal line (scaleY 0.02, opacity 1) and opens to full height (scaleY 1) like a hologram resolving, about 250ms.
3. It flies in a gentle arc (transform only, about 700ms) into the winner's locator strip, into that round's slot, and seats with a tiny scale 1.06 to 1.
4. The loser's slot for that round fills with the dim card back (fade).
5. Rows re-sort (FLIP with transform, about 450ms). The results feed gains the line at the top.
If the match is yours (code it generally), the card resolves in the centre of the field and flies into your round zone on the field instead of the rail.
A `confirmed` event: the 50% card fills to full and its clock fades. A `game` event: that match's score rolls.
Calm: no resolve and no flight; the card fades into its slot, rows slide. Off: instant.

## States

- **Lobby:** the field shows only your half lit. Their half is a dashed, unlit outline with "Your first opponent is drawn when the host starts." Your five round zones are empty outlines. Below the field, "Who's in (4 of 6 joined)" rows: monogram, name, tier, "Deck in" / "No deck yet", and "Leave" on your own row. The invite block: link in a read-only field, "Copy link", "Players can also join from Discord with /tournament join." "Your draft deck is used." Spectator (not joined): no seat of yours; "Join the tournament" primary button where your actions would be. Host on: inline host row under the field: "Start the tournament" (primary), "Add a bot", "Announce in Discord", "Cancel the tournament".
- **Live, spectator:** the field shows the live match (Marik_Mains v duel.josh), both halves in their ring colours, their round zones, the live game score, a small "Live now" label above the far seat. No stakes, no actions. Rail unchanged.
- **Waiting on you:** the centre of the field shows Kestrel's reported score "1 – 2" inside a gold rule frame, with "Kestrel reported that they won 2–1." Your round 3 zone shows Kestrel's locator card as a pending card (50%, clock) on THEIR row, so you see what confirming does. Under your seat: "Confirm" (primary) and "Deny" (secondary), "Confirms itself in 23 hours if you do nothing." in `--ink-3`. Stakes line changes to "−7 if you confirm" (use the real number).
- **Finished:** the field becomes the champion's field: only the far half is lit, in gold (`--chain` lines). The champion's seat at the far edge has a gold ring glow; their five round zones each hold a gold locator card. Across the centre: "Kestrel wins Cube cup 4" (name from data) in `--f-display`, `--chain-ink`, and their record "5–0". Near half unlit. "Back to the draft" link. Standings below with final ranks.
- **Single elimination:** the field's zones become three: "Round 1", "Round 2", "Final" (wider zones, labelled). Below the field, the standings are replaced by **your road**: a horizontal path of three stops drawn as a thin light line, each stop holding that round's matches as paired monogram chips with scores, your path traced in `--pen`, byes as a single chip with "Bye". The undrawn round says "Round 2 is drawn when Kestrel and duel.josh finish." After the first event: your round 2 zone says "Bye", and the field shows "Bye this round. You go straight to the final." with the final's opponent as a dashed far seat "Kestrel or Marik_Mains". Finished: champion Marik_Mains, you runner-up.

## Phone 390

Order: top bar (name + Animations as an icon button), the field (flat, no tilt; your row and their row of five zones at about 52px wide each, deck zone above each row instead of at the side, score in the middle), seats inline above and below, stakes, then standings (slots 16x24, names truncate), then the Tonight sections. Sticky bottom bar with "Start duel" and "Report a result" (or "Confirm" / "Deny"). Host tools opens a full-height sheet.
