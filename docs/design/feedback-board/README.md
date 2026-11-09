# Feedback board design workshop

**Status (2026-11-09): direction chosen (A · The Ladder), all nine questions answered, spec approved. The build is paused.** See [How to continue](#how-to-continue).

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

## Owner answers (2026-10-31)

1. **Direction:** A · The Ladder. The after-game ask is A's one ladder row, not B's card.
2. **Name:** "Ideas".
3. **Team:** a new permission. Holders' posts skip approval and carry the Team label. The owner holds it now; more users get it later.
4. **Who votes:** anyone who has finished one duel, draft or tournament match.
5. **Vote counts:** both counts shown. Rank is up minus down; ties go to more up votes.
6. **After-game ask:** at most once a day per player, only when there is an idea they haven't voted on. Never blocks Exit, Rematch or Replay.
7. **Rank system:** all six parts start as Open ideas.
8. **Author name:** the author chooses when posting; the name shows once the idea is approved, only if they chose to show it.
9. **Starting state:** Card details on phones and Theme drafts start In progress; Readable text and Format names are Open; Daily puzzle (NT-120) is left off.

## Files

- `workshop.html`: the assembled round 2 page. Do not edit it by hand; rebuild it.
- `shell.html`: page chrome, shared classes, and theme and mock tokens.
- `approach-a.html`, `approach-b.html`, `approach-c.html`: one chapter each.
  - Each chapter is self-contained and scoped: CSS under `.ap-x`, ids `apx-`, and one IIFE script.
- `compare.html`, `questions.html`: the comparison table and the open questions.
- `round-1/workshop.html`: round one (Next Turn, Set list, The Floor), kept as history. The owner rejected it as too complex. Round one's 29-artboard design canvas is https://claude.ai/artifact/Y2oAJAi4vJWXgwVVGQrrMD (private).
- `briefs/`: the designer briefs. Round 2 overrides round 1 where they differ; `agent-brief-final.md` (the final mock pass) overrides both.
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
sh tools/shot.sh "$PWD/shots/b.html" "$PWD/shots/b.png" 1440 1300   # headless Chrome ($CHROME, else macOS, else /usr/bin/google-chrome); widths under 500 use an iframe
node tools/assemble.mjs --final         # final mock page: final.html only, writes final-workshop.html (also takes --focus)
```

`shots/` is scratch output; do not commit it. Mock data uses invented handles and sample vote counts. The shipped lines come from real merged pull requests.

## How to continue

The owner paused the build on 2026-10-31. Nothing is merged. Pick up in this order.

**Where things are**

| What | Where | State |
|---|---|---|
| Workshop, owner answers, spec | this folder and `docs/specs/2026-10-31-ideas-board.md`, on `design/feedback-board-workshop` (PR #497) | Done. The spec is approved. |
| Final mock tooling | `tools/assemble.mjs --final`, `tools/check-fragment.mjs f`, the `shot.sh` Chrome fallback | Done. |
| Final mock | `final.html` (not written yet) | Stopped before it started. The brief is `briefs/agent-brief-final.md`. |
| Backend | branch `feat/ideas-board`, one commit on top of this branch | Written by Codex and read by Opus against the spec. The full test suites and typechecks have not been run yet. |
| UI build | | Not started. |

The backend is the schema (`ideas`, `idea_votes`, `idea_notices`, `user_permissions`, `users.ideas_prompt_at`), `createIdeaService` in `packages/shared/src/services/ideas.ts`, the routes under `packages/web/app/api/ideas/` and `packages/web/app/api/admin/console/ideas/`, the merge, fold and deletion updates, and the `ideas-seed` owner CLI. The API contract is `docs/api/ideas.md`, and the plan Codex followed is `docs/superpowers/plans/2026-10-31-ideas-backend.md`.

**Next steps**

1. **Final mock.** Give `briefs/agent-brief-final.md` to the Sonnet `ui-designer` agent. It writes `final.html` (screens `apf-s1` to `apf-s8`). Opus reviews the shots at 1440 and 390, then the owner reviews `final-workshop.html`.
2. **Verify the backend** on `feat/ideas-board`, with Node 22 and outside the Codex sandbox:
   ```bash
   export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
   npm ci && npm run build --workspace=packages/shared
   npm test --workspace=packages/shared && npm test --workspace=packages/worker && npm test --workspace=packages/web
   npm run typecheck
   ```
   Two small edge cases are open: after an account merge, the survivor can hold a vote on their own idea; the service loads every idea of the guild on each read (fine at this size).
3. **Build the UI** on `feat/ideas-board`, after the owner approves the final mock. Sonnet builds it on the API in `docs/api/ideas.md`:
   - the `/ideas` page with its two tabs;
   - the Ideas nav item with the notice dot;
   - the post form;
   - the Ideas section in the admin console;
   - the after-game row on the duel result, the draft finale and the tournament closed view.

   Opus reviews every diff and the screenshots at 1440 and 390.
4. **Ship.** Run the full test, typecheck and build. Open a PR from `feat/ideas-board` to `main`, and merge only on the owner's go. After deploy, the owner runs the seed once: `node packages/worker/dist/ops/cli.js ideas-seed`, which is a dry run, then again with `--apply`.

**Rules for this work.** Sonnet (`ui-designer`) does UI, and Codex does backend. Opus reviews every return and does all git writes. No merge without the owner's go.
