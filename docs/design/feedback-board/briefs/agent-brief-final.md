# Agent brief: final mock (Ideas, A · The Ladder)

Sent to the Sonnet `ui-designer` agent on 2026-10-31. Paths are relative to the repo root. The pass was stopped partway (see the README, "How to continue"); rerun it from this brief.

You are making the FINAL design mock for the "Ideas" board, a players' feature-ideas board in the Dueling Domain web app. The owner already picked the direction: Approach A, "The Ladder". This is a refinement pass on A, not a redesign. Keep A's visual craft and layout, and change only what is listed below. Design only: write HTML mocks, no app code.

Work directory: docs/design/feedback-board/ . Write files only inside it. Do not run git. Use Node 22: `export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH`.

Read first:
1. README.md, which has the owner's nine answers.
2. ../../specs/2026-10-31-ideas-board.md, the approved spec. Its "My defaults" list is approved.
3. briefs/agent-brief-round-1.md for the chapter structure and rules (scoping, colors, width, controls, copy, never naming the trademarked card game or its publisher, invented cast), and briefs/agent-brief-round-2.md. Round 2 wins where they differ, and this brief wins over both.
4. approach-a.html, your starting point; copy it.
5. research/recon-design-language.md.
6. For the admin screen only, the real console styling: packages/web/src/components/admin-console/admin-console.module.css, parts.tsx and views/waitlist.tsx, plus research/recon-admin-and-bug-reports.md. That screen must look like a real console section next to Waitlist, not like the A mock's approximation.

## Tooling to add (small)

- Create `final.html`, a chapter fragment. Copy approach-a.html and re-scope it to class `ap-f`, ids `apf-`, keyframes `apf-`. Start it with `<section class="ws-approach ap-f" id="approach-f">` and `<!--NAME:Ideas: final-->`.
- Extend tools/assemble.mjs with a `--final` flag. With it, the page gets only the final chapter (no A/B/C, compare or questions), the default output is `final-workshop.html`, and `--focus` still works. Without the flag, behaviour must stay exactly as now.
- Extend tools/check-fragment.mjs to accept `f`, reading final.html.
- tools/shot.sh hardcodes the macOS Chrome path. Make it use `${CHROME:-...}` and fall back to `/usr/bin/google-chrome` when the macOS path doesn't exist. This machine is Linux (WSL); Chrome is at /usr/bin/google-chrome.
- Update the hero/intro text of the final page to say: "Final mock for the build. The owner picked A, The Ladder, on Oct 31, 2026."

## What changes from A

- **Name:** the board is "Ideas" everywhere: the nav item, page title, headers, the console section and the copy. Remove every "Next Turn". The Done tab entries for the seeded shipped log say "Shipped before Ideas opened".
- **Nav dot:** the "Ideas" item in the app's sidebar nav carries a small unread dot when the viewer has unread notices. Use a small gold dot; gold is used sparingly, for active states.
- **Post form:** the only modal. It holds a title (80 characters max, with a counter appearing near the limit), "One line about it (optional)" (140 max), an area picker (Ranked, Duels, Drafts, Tournaments, Decks & cubes, Replays & watching, Community, App), a "Show my name" switch (on by default), and Post. Under the switch, in small muted text: "Your name shows once the idea is approved." Show two states: the validation line "Add a title first.", and the daily limit line "That's 3 ideas today. Try again tomorrow, or vote on one that's up."
- **Your ideas** (under the ladder): the viewer's Waiting row ("Waiting for approval · Only you and the team can see this") and a Declined row with its reason. For example: "Not added: Already on the board: Ranked queue." Give the Declined row a muted treatment. Show the reason as text only: the backend stores it as one string, so there is no link to another idea.
- **Notices** at the top of the Ideas tab: a short list (at most 3, then "Show all") with a Done notice, "Done: Card details that fit on a phone. You backed this." plus the optional owner note line, and a Declined notice. Unread items are marked, and they become read once the list is seen.
- **Not played yet:** the board as seen by someone with no finished duel, draft or tournament match. Vote buttons are hidden, "Suggest an idea" is disabled, and one line sits above the ladder: "Finish one duel, draft or tournament match to vote and post."
- **In progress band:** no vote buttons or counts, as in A.
- **After-game row** on three hosts, each drawn faithfully to the real screen. Read the real components to get the surroundings right, under packages/web/src/components/: duel/duel-result.tsx, draft/room/finale.tsx, and the tournament closed view (tournament/floor/live-view.tsx and sheet/tournament-sheet.tsx).
  - It is one ladder row (rank, title, area, both counts), Vote up, Vote down and "Suggest an idea", placed after the existing actions, never above or blocking them.
  - The idea shown is the NEWEST open idea the viewer hasn't voted on.
  - After a vote, the line under it reads, for example, "Thanks. It's now #12 of 17."
  - Show the duel result at full size. The draft finale and tournament closed view can be smaller frames.
- **Admin console "Ideas" section**, in the REAL console styling:
  - The rail gets an "Ideas" item with a Waiting count badge, next to Waitlist.
  - Four lists: Waiting (Approve, and Decline with the three preset reasons plus "Add a line (optional)"), Open (Start), In progress (Done), and Recent done.
  - Done opens an inline confirm with an optional one-line note: "Mark done and notify 14 players". After confirming, the row moves and the line reads "Notice sent to 14 players".
  - Approve and Start are one tap. Rows move between lists in the mock, as in A.
- **Done tab:** grouped by week, newest first, as in A, with the seeded weeks labelled "Shipped before Ideas opened".

## Screens: figure ids apf-s1 to apf-s8, wrappers and figcaptions as in A

- S1: Player board, desktop. Notices at the top, In progress band, ladder, Your ideas, nav dot.
- S2: Post form, desktop, with the switch and both message states.
- S3: Not played yet, desktop.
- S4: After-game row on the duel result, desktop.
- S5: After-game row on the draft finale and the tournament closed view (two frames).
- S6: Admin console Ideas section, desktop (`.ws-screen--admin`).
- S7: Done tab, desktop.
- S8: Phone (390). The board with notices, the post form, and the after-game row on the duel result.

Mock data: invented handles only, and sample vote counts are fine. Keep the cast and ideas from A. The viewer is lumen. Mock "today" is Fri Oct 30, 2026. Plain English labels only, and no help paragraphs. One tap per interaction. Votes toggle, and rows slide when the rank changes, as in A.

## Checks before you report

- `node tools/check-fragment.mjs f` reports 0 errors.
- `node tools/assemble.mjs --final` writes final-workshop.html.
- `node tools/smoke.mjs final-workshop.html` reports no script errors, duplicate ids or dead links.
- `node tools/check-fragment.mjs a` still passes, and `node tools/assemble.mjs` still writes workshop.html unchanged from the current one apart from nothing. Verify with a diff that the A/B/C page is unaffected.
- Screenshots: every screen at 1440 and the phone at 390, for example `node tools/assemble.mjs "$PWD/shots/f-s1.html" --final --focus apf-s1 && sh tools/shot.sh "$PWD/shots/f-s1.png"`. Use the shot.sh argument order: page, out, width, height. Read every PNG yourself and fix what looks wrong: clipped text, overflow, misaligned rows, a console screen that doesn't match the real console, and no sideways scroll at 390 outside the scroll wrappers.
- Keep final.html under about 110 KB.

Report: the files changed, a one-line summary per screen, the screenshot paths, anything you had to interpret, and anything you think the owner should decide.