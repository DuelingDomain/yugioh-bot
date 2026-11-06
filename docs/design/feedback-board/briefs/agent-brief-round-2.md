# Workshop brief v2: rework one approach chapter, much simpler

The owner looked at round one and said the designs are too complicated. Their words: "we don't need to track all these different progress of a feature, because then we're gonna have to keep updating them. Just keep it really simple: it's in progress, and then let them know when it's done. That's it. The board should be simple, easy, intuitive UX, with unique and creative designs."

You rewrite ONE approach chapter from scratch. Read briefs/agent-brief-round-1.md first: its Paths, Chapter structure, Rules (scoping, colors, width, controls, copy, never naming the trademarked game or publisher, invented cast) and Done means all still apply. This file REPLACES its request list, its screens list, its seed statuses and its "push the concept" advice. Where they disagree, this file wins.

Round one's assembled page is round-1/workshop.html, for reference only. Do not copy their mechanics. Take visual craft from them if it helps.

## The whole model (identical in all three approaches)

An idea has exactly these states:

1. **Waiting**: just posted. Only its author and the owner see it ("Waiting for approval"). Team posts skip this.
2. **Open**: approved and on the board. Anyone who plays can vote up or down.
3. **In progress**: the owner tapped Start. One label, nothing else. No steps, percentages, dates, stages or update posts.
4. **Done**: the owner tapped Done. Everyone who voted up, plus the author, gets one in-app notice: "Done: <title>. You backed this." The idea moves to the Done list.

Declined ideas leave the board. The author sees a short reason (a preset such as "Already on the board", "It's a bug, reported for you", or "Not for now", or one typed line).

The owner's whole job is three actions in the existing admin console: **Approve or Decline**, **Start**, **Done**. Done may take an optional one-line note shown in the notice; it is never required.

## Removed: do not draw any of these

Steps, stations, tracks, stage menus, percentages, update chains, follows, watch, live lamps, "rising" or momentum, release windows, sets, packs, print runs, field reports, "Working well?" surveys, playtesters or Testing, weekly logs, merge flows, umbrella ideas with nested parts, reasons-for-downvote forms, keyboard-shortcut hints. If a screen needs a paragraph to explain, cut it.

## The request (codes reused across the page)

- R1 Intake board: a place that collects ideas from players.
- R2 Owner approval: the owner approves an idea before everyone sees it.
- R3 Seeded features: starts with the rank system plus team ideas.
- R4 Prompts after activities: asks at the end of duels, drafts and tournaments so the board stays full.
- R5 Upvote and downvote: both directions count.
- R6 Simple progress: In progress, then a notice when it's Done.
- R7 Players and team both post and vote.
- R8 Controlled from the existing admin console: Approve, Start, Done.

## Simplicity rules (the owner will judge on these)

- A first-time player understands the board in five seconds with no help text.
- One primary action per screen region. The board has at most three views (for example Ideas, In progress, Done).
- An idea row or card shows: title, one-line pitch, area tag, Team label if any, votes, and a state chip only when it is not Open. Nothing else at rest.
- Posting an idea is one title field, one optional line, an area picker and a post button.
- Every interaction is one tap. No modals except the post form.
- Creativity lives in layout, shape and motion, never in extra mechanics or invented vocabulary. Every label is plain English: "Ideas", "In progress", "Done", "Suggest an idea", "Vote up", "Vote down".

## Seed statuses for v2 (use these, not the product brief's)

- **In progress (2)**: NT-117 Card details that fit on a phone (votes 13 up, 0 down); NT-116 Theme drafts (10 up, 1 down). No steps.
- **Open**: the rank system as six separate ideas, each tagged "Ranked" with the Team label. Use the refs, titles, pitches and votes from research/product-brief.md 5a: NT-102 Ranked queue 14/1, NT-103 Placement series 9/2, NT-104 Separate Standard and Domain ratings 11/3, NT-105 Seasons with a soft reset 7/4, NT-106 Season crest and seat frame 8/0, NT-107 Ladder sorted by rating 6/2. Shorten their pitches to one line. Grouping them under a "Ranked" filter is fine; nesting is not.
- **Open, also**: NT-108 to NT-115 from 5b (Team), NT-118 Readable text everywhere and NT-119 Clear, consistent format names (Team, now plain Open), and NT-121 Rematch button by vexmoth (9/1).
- **Done**: the real shipped lines from research/product-brief.md 5e, newest first, as Done entries with their week. "This week: nothing yet" is a fine empty state.
- **Waiting, admin queue**:
  - NT-123 sleeves by kestrel9, 2d;
  - NT-124 keyboard shortcuts by lumen, 1d (lumen is the mock viewer, so it shows on lumen's side as their Waiting idea);
  - NT-125 "pls ranked matchmaking" by mossgiant, 6h (the decline preset "Already on the board: Ranked queue");
  - NT-126 the trap bug by pellucid, 3h (the decline preset "It's a bug, reported for you").
- Drop NT-120 Daily puzzle and NT-101 as an umbrella.
- Mock "today" stays Fri Oct 30, 2026.

## Screens (exactly five, same wrappers and figcaptions as in briefs/agent-brief-round-1.md)

- **S1 Player board (desktop).** Your concept's main idea, with In progress and Done reachable.
- **S2 Suggest an idea and hear back (desktop).** The post form, lumen's own Waiting idea, and the Done notice as the player receives it (for example the notice for NT-117).
- **S3 End-of-activity prompt (desktop, on the duel result screen).** One small ask, such as one idea to vote up or down plus "Suggest an idea". It must never block Exit, Rematch or Replay.
- **S4 Owner console (desktop, `.ws-screen--admin`).** The Waiting queue with Approve and Decline, Open ideas with Start, and In progress with Done. Make Start and Done work in the mock (the item moves between lists; Done shows "Notice sent to N players").
- **S5 Phone (390).** The board, and the S3 prompt if room allows.

Make up and down votes toggle, plus your signature interaction.

## Three concept directions (one per designer; push yours, keep it simple)

- **A: "The Ladder".** Ideas ranked like the app's leaderboard: a clean ranked table, #1 at top, rank number, title, tag and votes, which competitive players read instantly. In progress items are pinned above the ladder as a short band. Done is its own view, styled as a roll of honour. Creative angle: typography and rank treatment (big numerals, top-3 emphasis, the rank shifting when you vote).
- **B: "One pick at a time".** Borrowed from drafting. The board opens on a single idea card, big and centred. Vote up or down and the next card slides in, like making a pick, with a "See all ideas" list one tap away for browsing. In progress and Done sit as two slim shelves under the card. Creative angle: the card stack, the slide-in, and the satisfaction of a pick.
- **C: "The Field".** The board is a play mat with three zones read left to right: Ideas (a grid of idea cards with votes), In progress (the few cards placed face-up in the middle zone), Done (a pile with a count that opens to the list). The whole state of the board is visible at a glance on one screen. Creative angle: the mat, the zones, a card sliding from Ideas to In progress to Done when the owner acts.

Each direction gives its chapter its own name (short, plain), thesis and model diagram. The model diagram is now four boxes at most: Waiting → Open → In progress → Done.

## Size and checks

- Aim under 90 KB. Build size should come out S, or M with a reason.
- You may now check visually with headless screenshots, which never touch the user's browser:
  - `cd WS && node tools/assemble.mjs "$PWD/shots/<x>2-s1.html" --only <x> --focus ap<x>-s1 && sh tools/shot.sh "$PWD/shots/<x>2-s1.html" "$PWD/shots/<x>2-s1.png" 1440 1300`, then Read the PNG.
  - Use figure ids `ap<x>-s1` to `ap<x>-s5`.
  - For phone width, shoot at width 390. The tool handles widths under 500.
- Only write files in `shots/` named `<x>2-*`.
- Before finishing:
  - `node tools/check-fragment.mjs <x>` must report 0 errors;
  - `node tools/assemble.mjs "$PWD/shots/<x>2-all.html" --only <x> && node tools/smoke.mjs "$PWD/shots/<x>2-all.html"` must report no script errors;
  - the chapter at 390 wide must have no sideways scroll outside `.ws-screen-scroll` and `.ws-req-scroll`. Give `.ws-fig` and `.ws-block` grid children `min-width:0`, and keep the phone at `width:min(390px,100%)` with `box-sizing:border-box` where needed.
- Reset rule from round one: if you reset buttons or margins inside your mocks, wrap the reset in `:where()` (for example `.ap-x :where(.mock) button{...}`), so it never overrides your component classes. Round one lost every button style to this.
