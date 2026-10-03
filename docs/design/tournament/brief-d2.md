# Concept D, version 2: the owner picked it. Update d.html / d.js / d.css in place.

The owner picked D (Solid Vision). Read `brief-common-2.md`, `brief-d.md` and the current `d.html`, `d.js` and `d.css` first. Version 1 is saved as `d-v1.*`. Don't edit those, or any file other than `d.html`, `d.js` and `d.css`.

**What changed, and why.** The tournament page sits on top of the site's duel system:
- Every tournament match is played as an online duel series (best of 3).
- The duel records each game's result itself and pushes it to this page live.
- The page's job is to show every match being played and get you into your duel fast.

The owner gave three answers. They **replace** these older rules:
- "Never offer Watch for a live match" (brief-common-2)
- "Live, spectator: no actions" (brief-common-2)
- "Tournament games are private" (data.js header)

## 1. Every match in the round shows at the top

The top of the page becomes **the round**: your field, plus every other match in the current round.

- **You are playing in this round:**
  - Your match stays the big tilted field from v1, unchanged in look.
  - Directly under it, a row called "Every table this round" holds **small fields**, one per other match in the round. They're smaller and less prominent, but still clearly D.
- **Small field.** A mini, flat (no tilt) version of the field, about 300x150, in D's language: thin light lines, each player's half in their ring colour, a centre line. It holds:
  - Both players: monogram ring 28px and name, on their half.
  - The series score in the middle (`--f-display`), and the best-of-3 marks.
  - A status line: "Game 2 in progress" (with a small live dot that breathes on Full), "Between games. Game 2 next.", "Not started", "Reported by voidpriest. Waiting for BlueEyesBen." or "Final".
  - A small table number "Table 2" in `--ink-3`.
  - No round zones and no stakes.
- **You are not playing this round, or you're a spectator (not in the tournament):**
  - There is no big field.
  - The top is a heading "Round 3 of 5. Every table." and an equal grid of the round's matches. Each is a **medium** field (same anatomy as the small field, about 420x210, flat), and none is bigger than the others.
  - Each medium field also shows the two players' round rows as tiny slots (wins as gold locator cards), so watching still shows how each player's night is going.
- **Scale rule.** Tournaments can come from 12-player drafts, which means 6 tables. Lay the tables out as follows:
  - **Desktop:** a CSS grid with `repeat(auto-fill, minmax(300px, 1fr))`, which wraps into rows.
  - **Phone:** one horizontal row that scrolls inside its own container with scroll-snap (`overflow-x: auto` on the row only). The page itself must never scroll sideways.
  - **Rounds:** a 12-player round robin has 11 rounds. The field's round row shows at most 5 zones: the 2 rounds before the current one, the current round, and the 2 after. At each end there's a small counter for the rest ("Rounds 1 to 3: 2 wins").
  - The data has 5 rounds, so build the rule generally and it will just show all 5. Write a code comment saying so.

**Mock data override.** In the default round-robin live state, nothing is mid-game, so there would be nothing to watch. Add one more override in d.js, next to the name wrapper. In round-robin live (and confirm) snapshots, set match 8 (Marik_Mains v duel.josh) to `status: "live"`, `games: [1, 0]`, `game: 2`. Leave data.js unedited. Check that the "A duel finishes" event for match 8 still works.

## 2. Anyone can watch a live duel

- Every match with a game **in progress** (`status: "live"`) has a **"Watch"** button, a secondary outline button, on its small or medium field. This goes for players and spectators alike.
- Between games, a reported match, a finished match and a match not started have no Watch.
- Your own match never shows Watch. You get your own actions instead (below).
- The rail's "Live now" section is removed, because the tables now show it. The rail keeps "Waiting to confirm", "Results" and "Rules".
- In the mock, Watch is a `<button>` that does nothing visible except a small toast at the bottom: "Opens the duel to watch." (fades out after 2s).

## 3. Your actions come from your duel

The actions under your seat follow your match's duel state, from the data:
- **Not started** (`open`): primary "Start duel".
- **A game in progress** (`live`): primary "Open duel", and the field centre says "Game N in progress".
- **Between games** (`between`): primary "Open duel", and the centre says "Between games. Game N next."
- **After pressing Start duel in the mock:** switch your match to live game 1 (v1 had a similar flow; keep it working). Then "A duel finishes" can fire your own game event.
- **"Report a result"** is no longer a button next to Start duel. It becomes one quiet line under the actions, in `--ink-3` with a plain text link: "Played off the site? Report a result". It's a backup for games not played in the duel room.
- **The confirm state ("Waiting on you")** still exists, because it only happens after someone reports a result by hand. Keep v1's confirm design, and change the line to "Kestrel reported by hand that they won 2–1."

## 4. Results arrive from the duel

- Rename the mock control "A result comes in" to **"A duel finishes"**, and its helper text to "Simulates the duel system sending a finished game."
- The moment is the same as v1, but it starts from that match's **table field** (small or medium) instead of the rail's "Live now" line:
  1. The score digits roll.
  2. The gold locator card resolves like a hologram (scaleY from a thin line).
  3. It flies to the winner's slot in the standings, or to your field's zone if it is your match.
  4. Rows re-sort, and the feed gains the line.
- After a final, that table's status becomes "Final", and its Watch button fades out.
- A `game` event (one game ended, the series goes on) rolls that table's score and changes its status to "Between games. Game N next."

## 5. Keep everything else from v1

Keep these from v1:
- the tilted field and round zones
- the standings with locator strips
- the lobby, finished and single-elimination states
- host tools, the Animations setting and phone layout rules
- the tournament name wrapper
- every writing rule in brief-common-2, except the three rules replaced above

In single elimination: round 1's live match is Kestrel v duel.josh in game 3, which gets a Watch button. Your field shows your finished round-1 win, as in v1.

## Screenshots

Take the full list from brief-common-2 again with letter d, overwriting the old files. Add these:
- `d-1440-live-spectator-grid` (`viewer=spectator`)
- `d-1440-moment-table` (`anim=full`): open the mock controls, click "A duel finishes", and wait about halfway through the moment
- `d-390-live-vp`: phone viewport, not full page
- `d-390-spectator-vp`

Look at every shot with the Read tool, fix what's wrong, then reply in the short format from brief-common-2. Also list any place where these rules conflicted with v1 and what you chose.
