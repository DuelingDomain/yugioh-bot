These proof scripts render the shipped duel components from real stock-core snapshots. They capture
all screenshots before asserting the desired fixed behavior; a regression reports `BUG 1:`,
`BUG 2:` or `BUG 4:` and exits nonzero. Each run rebuilds the shared browser entry so rerunning after
a production fix proves the new behavior. No login, services, database writes or repo dependencies
are needed. Playwright is external, as in target-response.playwright.ts.

From the repository root:

```bash
source ~/.nvm/nvm.sh && nvm use 22.23.2
export PROOF_DIR=/tmp/yugioh-proofs
export PLAYWRIGHT_MODULE=/home/imran/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs
export CHROMIUM_PATH="$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"

node --import tsx packages/web/e2e/search-reveal.playwright.ts
node --import tsx packages/web/e2e/deck-set.playwright.ts
node --import tsx packages/web/e2e/material-count.playwright.ts
```

Use the paths to your own installed Playwright/Chromium if these cached paths differ. Run all three
commands; each exits zero when its bug stays fixed. Set `PROOF_WIDTH=390` for phone-width shots. JSON lines on stdout and `evidence.json` contain
the actual DOM copy, visible identity, counter/instruction and screenshot paths.

| Script | Engine scenario | Screenshots beneath `$PROOF_DIR` |
| --- | --- | --- |
| search-reveal | Reinforcement of the Army adds Kojikocy; opponent and spectator | `bug-1/{opponent,spectator}-{history,showcase}.png` |
| deck-set | Ogama Sets Majespecter Tempest; opponent and spectator | `bug-2/{opponent,spectator}-set.png` |
| material-count | Junk Archer, Utopia, Paladin of White Dragon; summoning seat | `bug-4/{synchro,xyz,ritual}-{0,1,2}-selected.png` |

Each directory also contains `snapshots.json` and a standalone `bundle/index.html`. Search proofs
show history alongside the real Added to hand showcase. Playwright pauses removal timers and seeks
the real animation into its readable hold; public identity is never supplied by the harness.
Images use labelled SVG placeholders and the shipped card backs, matching the existing approach.
Set proofs require public identity in history/reveal while the field retains a face-down position
and renders a card back.

For Synchro/Xyz, the first two states are untouched core prompts. The core completes immediately
on the second material, so the last screenshot is explicitly labelled a **pending-answer preview**:
the browser retains the last real prompt and changes only the second clicked option's selected flag.
Its original min/max, text, options and board remain intact. `completedView` in `snapshots.json`
contains the resulting real summon and its Graveyard/Xyz materials. This preview tests `2 selected`
without inventing a third core prompt or a total. Ritual uses the same real sum prompt with local
draft picks throughout, and asserts `Total at least 4` plus the selected Level values (`2 + 3`).

To generate and validate snapshots/builds without launching Chromium or requiring Playwright:

```bash
node --import tsx packages/web/e2e/search-reveal.playwright.ts --prepare-only
node --import tsx packages/web/e2e/deck-set.playwright.ts --prepare-only
node --import tsx packages/web/e2e/material-count.playwright.ts --prepare-only
```

`--prepare-only` does not run browser assertions and does not claim that the bugs pass.
