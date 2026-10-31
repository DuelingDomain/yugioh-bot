# Feedback board design workshop

**Status: in progress, no direction chosen (2026-10-31).** Design only. No app code is written until the owner approves a direction and the open questions are answered.

Players need a place in the web app to suggest features and vote on them, with the owner approving ideas and showing what's in progress and done. This folder holds the workshop page that compares three approaches, its sources, and the research behind it.

Live copy (private to the owner): https://claude.ai/artifact/2upRcaCtZrEGpawxAecFcc. `workshop.html` here is the same page; open it in a browser.

## The request

- R1 Intake board: a place that collects ideas from players.
- R2 Owner approval: the owner approves an idea before everyone sees it.
- R3 Seeded features: starts with the rank system plus team ideas.
- R4 Prompts after activities: asks at the end of duels, drafts and tournaments so the board stays full.
- R5 Upvote and downvote: both directions count.
- R6 Simple progress: In progress, then a notice when it's done.
- R7 Players and team both post and vote.
- R8 Controlled from the existing admin console.

## Decided so far

The owner rejected round one as too complicated (2026-10-30): "we don't need to track all these different progress of a feature, because then we're gonna have to keep updating them. Just keep it really simple: it's in progress, and then let them know when it's done."

So every approach now shares one model:

1. **Waiting**: a new player idea is visible only to its author and the owner. Team posts skip this.
2. **Open**: approved and on the board. Players vote up or down.
3. **In progress**: the owner tapped Start. One label, nothing else.
4. **Done**: the owner tapped Done. Up-voters and the author get one in-app notice.

Declined ideas leave the board, and the author sees a short reason. The owner's whole job is three admin-console actions: Approve or Decline, Start, Done. There are no steps, stages, dates, update posts, release windows or surveys.

## Round 2: the three approaches

All three are small builds (S).

- **A · The Ladder**: ideas ranked like the leaderboard. In progress is pinned above the ladder and Done is its own tab.
- **B · One pick at a time**: one idea card at a time, as in a draft pick, with "All ideas" one tap away. In progress and Done sit in two shelves under the card.
- **C · The Field**: a play mat with three zones (Ideas, In progress, Done). The whole state is visible at a glance.

Recommendation on the page: A's ladder as the board, plus B's one-card pick as the after-game prompt and a "Vote on new ideas" entry. This covers A's weak spot, which is that new ideas start at the bottom.

## Open questions (go through them one at a time, in this order)

1. Which direction: A, B, C or a blend?
2. Board name: "Next Turn" (A and C) or "Ideas" (B)?
3. Who counts as Team: only the owner, or named helpers too?
4. Who may vote: after one finished activity, or anyone signed in?
5. Show both vote counts, or one net score?
6. How often the after-game ask appears.
7. The rank system: are all six parts really open, or are some decided?
8. Author name shown by default?
9. Starting state: are Card details on phones and Theme drafts really In progress?

## Files

- `workshop.html`: the assembled round 2 page. Do not edit it by hand; rebuild it.
- `shell.html`: page chrome, shared classes, and theme and mock tokens.
- `approach-a.html`, `approach-b.html`, `approach-c.html`: one chapter each.
  - Each chapter is self-contained and scoped: CSS under `.ap-x`, ids `apx-`, and one IIFE script.
- `compare.html`, `questions.html`: the comparison table and the open questions.
- `round-1/workshop.html`: round one (Next Turn, Set list, The Floor), kept as history. The owner rejected it as too complex. Round one's 29-artboard design canvas is https://claude.ai/artifact/Y2oAJAi4vJWXgwVVGQrrMD (private).
- `briefs/`: the designer briefs. Round 2 overrides round 1 where they differ.
- `research/product-brief.md`: product context, seed ideas and visual system for the mocks.
  - Seed content: the rank system's six parts, team seeds, player samples and the real shipped log.
  - The round 2 brief overrides its seed statuses.
- `research/recon-*.md`: code recon behind the brief: admin console and bug reports, completion moments (where prompts can go), design language, and features, rank and shipped history.
- `tools/`: rebuild and check scripts (Node 22).

## Rebuild and check

```bash
cd docs/design/feedback-board
node tools/check-fragment.mjs a          # scoping, ids, controls, banned names; must report 0 errors (also b, c)
node tools/assemble.mjs                  # writes workshop.html
node tools/smoke.mjs workshop.html       # jsdom: clicks every button, reports script errors, duplicate ids, dead links
node tools/assemble.mjs shots/b.html --only b --focus apb-s4   # one chapter, one screen
sh tools/shot.sh "$PWD/shots/b.html" "$PWD/shots/b.png" 1440 1300   # headless Chrome (macOS path); widths under 500 use an iframe
```

`shots/` is scratch output; do not commit it. Mock data uses invented handles and sample vote counts. The shipped lines come from real merged pull requests.
