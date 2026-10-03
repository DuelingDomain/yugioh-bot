# Tournament concept mock, round 2: shared brief (read all of this first)

You are building ONE working HTML mock of the tournament page for a Yu-Gi-Oh cube-draft Discord community site ("Duelist's Kingdom", duelistskingdom.com). The design is already decided by the design lead; it is written in your concept section below. Your job is to build it faithfully and well. Do not invent new layouts, features, sections or copy. Where something is not specified, choose the plainest option that fits the written design, and list it under "Choices I made" in your reply.

## Folder and files

- Work only inside `/tmp/claude-1000/-home-imran-orca-workspaces-yugioh-discord-bot-ui-design-refresh/1b0a3b5c-fedc-4f51-a0fd-7e7f17e00079/scratchpad/concepts/tournament/`.
- Your files: `<letter>.html` plus optionally `<letter>.js` and `<letter>.css` (letter is d or e). Do NOT edit `data.js`, `brief-*.md`, or another concept's files (a, b, c and the other round-2 letter).
- Load the shared data with `<script src="data.js"></script>` and read `data.js` fully: it is the only data source (players, matches, states, events, standings, Elo stakes). Don't hard-code results that data.js already gives.
- Load the mock-controls styles with `<link rel="stylesheet" href="../shared/kit.css">` and use its `.kit-demo-tab` / `.kit-demo` classes for the grey "Mock controls" tab on the right edge (read kit.css for the class names). Write your own small panel content.
- Images: the ONLY image file you may use is the card back, `../assets/card-back-main-hd.webp`, and only as a quoted CSS `url("../assets/card-back-main-hd.webp")` or a JS string with that exact path. Draw everything else with CSS and inline SVG. No other files under `../`, no `<img>` tags pointing at files. (The mock is packed into one file for the owner's phone, and that packer only knows this one image.)
- **Tournament name.** The sample data calls it "Friday cube night". Don't use that name. At the top of your JS, wrap the snapshot so every state uses a neutral name:
  ```js
  const _snap = TourData.snapshot;
  TourData.snapshot = (...a) => { const s = _snap(...a); Object.assign(s.tournament, { name: "Cube cup 4", fromDraft: "Cube draft 4", inviteLink: "duelistskingdom.com/t/cube-cup-4" }); return s; };
  ```
  The page `<title>` is "Cube cup 4". Any copy that names the tournament or the draft must read it from `s.tournament`.
- **Where this comes from.** Concept A ("Battle City", `a.html`, brief in `brief-a.md`) is the direction the owner liked. Read `brief-a.md` and open `a.html` to see it. But the owner does NOT want A's game-night setting: no wood table, no lamp cones, no cosy night-in feel. Your concept keeps A's idea and puts it in a different world, as your section says. Do not copy a.css.

## Visual language (fixed for both round-2 concepts)

Use exactly these tokens and fonts (the site's draft room uses them too, so the pages sit together). Your concept section may add a few material colours; it says which. No other fonts.

```
--ground:#070b15; --panel:#0a1120; --panel-2:#0e1729; --panel-3:#132037;
--ink:#efe7d5; --ink-2:#c3bba8; --ink-3:#958f81; --ink-4:#5f5c57;
--rule-rgb:181 153 99; --rule-lo:rgb(var(--rule-rgb)/.16); --rule:rgb(var(--rule-rgb)/.3); --rule-hi:rgb(var(--rule-rgb)/.58);
--pen:#9b7eff; --pen-ink:#c6b6ff; --pen-fill:#5733d1; --pen-soft:rgb(155 126 255/.13);   /* you, and your actions */
--chain:#e4b64f; --chain-ink:#f4d690;   /* wins, gold, the champion */
--loss:#e45a4d; --loss-ink:#ff9489;     /* losses, red states */
--f-ui:"Sofia Sans Semi Condensed"; --f-num:"Sofia Sans Extra Condensed"; --f-display:"Oxanium";
--ease:cubic-bezier(0.16,1,0.3,1);
```
Google Fonts link:
`https://fonts.googleapis.com/css2?family=Oxanium:wght@500;600;700;800&family=Sofia+Sans+Extra+Condensed:wght@300;400;500;600&family=Sofia+Sans+Semi+Condensed:wght@300;400;500;600&display=swap`

- The ground is dark navy. There is NO warm lamp light and NO wood anywhere. Gold rules (`--rule*`) frame important objects. Violet (`--pen`) always means you. Gold (`--chain`) means a win or the champion. Red means a loss or something that needs action against a clock.
- Players are monograms in a coloured ring (`mono` and `ring` from data.js). There are no avatars.
- Tier shows as a small gem shape in the tier colour (`TIER_COLOUR`) plus the tier word or the Elo number, never a picture.
- Big numbers (scores, Elo, ranks) use `--f-num` or `--f-display`. Body is `--f-ui`, 15–16px, line-height ~1.45.
- Desktop top bar: back chevron, then the tournament name with a small second line ("The duels. Round robin, best of 3."), then the concept's own bar items, then an "Animations" button on the right (Full, Calm, Off).

## Writing rules (the owner is strict about these)

- Sentence case everywhere. Never type text in capitals, and never use `text-transform: uppercase`.
- No "→" or arrows in text. No middle-dot-joined meta lines like "A · B · C". Write short plain sentences or separate elements.
- Plain words a player would use: "Start duel", "Report a result", "Confirm", "Deny", "Copy link", "Announce in Discord", "Add a bot", "Start the tournament", "End now", "Cancel the tournament", "Deck in", "No deck yet", "Bye". Use these exact labels where they apply.
- Use "they/them" for players in any sentence.
- Never show a dollar amount, prize, or "winnings".
- Never show another player's deck name or cards. Deck status is only "Deck in" or "No deck yet".
- Tournament games are private: never offer "Watch" for a live match. Show its game score and game number only.

## Motion

- Animate only `transform` and `opacity` (no width, height, top, left, box-shadow or filter animation).
- An Animations setting with three levels, saved in localStorage key `yd-anim` (wrap in try/catch) and defaulting to Calm when `prefers-reduced-motion: reduce`:
  - Full: everything, including your concept's one orchestrated moment and a little ambient life (your section says what).
  - Calm: the orchestrated moment plays shorter and simpler; no looping ambient motion.
  - Off: nothing moves; state changes are instant.
- Your concept has ONE orchestrated moment (described below). Make that one great. Don't add entrance animations on every section or hover lifts on every element.

## States (all from data.js, switched in the mock controls)

The mock-controls panel (grey, right edge, collapsed by default) has:
- Format: Round robin / Single elimination.
- State: Lobby / Live / Waiting on you (the "confirm" state) / Finished.
- Viewer: Player (you are Imran) / Spectator (a guild member who isn't playing).
- Host tools: on/off (you are the host when on).
- Button: "A result comes in" (calls `TourData.nextEvent(snap)`, then re-renders with your moment). Disabled when it returns null.
- Button: "Reset".
Also read these from the URL so screenshots can be taken: `?format=single_elim&state=done&viewer=spectator&host=1&anim=off`. Defaults: round_robin, live, player, host off, anim from storage.

What each state must show (your concept section says how):
- Lobby (tournament pending): who has joined (4 of 6 in data), each player's deck status, a Join button for a viewer who hasn't joined (Spectator viewer in lobby = not joined yet; Player viewer = joined), "Leave" for a joined player, the invite link with "Copy link", and "Players can also join from Discord with /tournament join." Host tools in lobby: "Start the tournament" (needs 2 or more players), "Add a bot", "Announce in Discord", "Cancel the tournament". Your deck: "Your draft deck is used." with status.
- Live, player: your next duel with the opponent, both Elo numbers and tiers, the Elo stakes from `TourData.stakes` ("+N if you win", "−N if you lose"), "Start duel" (primary) and "Report a result" (secondary). Everyone's matches, standings, the results feed, the rules.
- Live, spectator: no "your" section and no actions; the concept's lead shows the night instead (your section says how).
- Waiting on you (confirm): the reported result waiting on you is the loudest thing on the page: who reported it, the score, "Confirm" (primary) and "Deny" (secondary), and "Confirms itself in 23 hours if you do nothing." (use `confirmHoursLeft`).
- Finished: the champion is the hero (gold), final standings or the completed bracket, and "Back to the draft" link. No other actions. ("Run it back" is not a feature; don't add it.)
- Host tools on (live): "End now" (unplayed matches stay unplayed and no champion is recorded) and "Cancel the tournament" (removes it for everyone, results and Elo included), plus everyone's deck status. Put them in a host drawer or panel as your concept says; destructive ones in red outline buttons, each with its one-line consequence.
- Single elimination specifics (from data.js): in Live, round 1 is still running (Kestrel v duel.josh in game 3), so round 2 is not drawn yet; say "Round 2 is drawn when Kestrel and duel.josh finish." After the first event, round 2 appears: you have a bye ("Bye this round. You go straight to the final.") and Kestrel v Marik_Mains is open. Byes must look like a bye, not like a match.
- Rules (both formats): from `tournament.rules`, plus "Made from the draft Cube draft 4" linking back (`#`).

## Layout

- Must work at 1440x900 and 390x844 with no horizontal page scroll. Use a 16px side gutter on phone.
- The desktop page should feel like one room, not a stack of cards. Avoid the "SaaS card grid": no identical rounded cards with soft grey shadows, no gradient washes as decoration.
- Phone: the concept's lead comes first, then your actions in reach (a sticky bottom bar for "Start duel"/"Report a result" or "Confirm"/"Deny" when they exist), then the rest.

## Quality floor

- Keyboard: every control reachable, visible focus ring (2px `--pen-ink` outline, offset 2px).
- Buttons are real `<button>`s; links are `<a>`.
- Contrast: body text on navy at least `--ink-2`.
- No console errors.

## Check your work, then reply

Screenshot tool (Playwright, already installed):
```
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
SP=/tmp/claude-1000/-home-imran-orca-workspaces-yugioh-discord-bot-ui-design-refresh/1b0a3b5c-fedc-4f51-a0fd-7e7f17e00079/scratchpad
node $SP/render/mockshot.mjs $SP/concepts/tournament/shots "file://$SP/concepts/tournament/<letter>.html?anim=off@1440x900:<letter>-1440-live" ...
```
Spec format: `<url>@<W>x<H>[@full][@click=<css selector>][@wait=<ms>]:<name>`. It prints `overflowX` (must be 0) and any console errors (must be none). Ignore a favicon 404 if one appears.

Take at least these, all with `anim=off` unless noted, and LOOK at every one with the Read tool and fix what's wrong before replying:
- `<letter>-1440-live` (round robin, live, player)
- `<letter>-1440-confirm`
- `<letter>-1440-spectator`
- `<letter>-1440-lobby-host` (`state=lobby&host=1`)
- `<letter>-1440-done`
- `<letter>-1440-se-live` (`format=single_elim`)
- `<letter>-1440-se-done`
- `<letter>-1440-host` (live with `host=1`, host panel open if it's a drawer: use `@click=`)
- `<letter>-1440-moment` (with `anim=full`, click the "A result comes in" control and `@wait=` about halfway through the moment, so the moment is caught mid-flight; open the mock-controls tab first with another `@click=` if needed)
- `<letter>-390-live@full`, `<letter>-390-confirm@full`, `<letter>-390-se-live@full`

Reply with: the file list, every screenshot name with its overflowX, "Choices I made" (anything the brief didn't specify), and anything in the brief you could not do. Keep the reply short.
