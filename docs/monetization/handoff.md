# Monetization research handoff

Status on 2026-10-31: research done, nothing decided, nothing in the codebase changed.

## Where the research lives

The full decision brief is a private Claude artifact: https://claude.ai/artifact/1yQecC6qctFWnpaNjibQUw. Only the owner's account can open it. It has these sections:

- verdict and Claude's revised take;
- 44 comparable sites and products;
- staged path, revenue scenarios and a calculator;
- risks;
- 14 open decisions;
- corrections, fact-checks and sources.

The detailed source research stays in the artifact on purpose, because this repository is public. Answers to the Decisions section are stored in the browser where they were entered. Use "Copy my decisions" there to carry them into a new session.

## What we concluded

- **Ads don't pay at our size.** Most time is spent on duel and draft screens, and those must stay ad-free. At 1k daily users, the calculator's default inputs give about US$144 a month from light ads plus a supporter tier. The first estimate in the session was 3–10× too high.
- **Mobile app stores and ads inside AI assistants aren't open to this app.** That leaves the web.
- **Comparable fan sites pay their way with donor cosmetics, small supporter tiers and light ads on browsing pages.** Patronage alone earns little; one comparable project shows about US$73 a month.
- **Selling the platform to other card games is a long shot.** Most publishers forbid paid access to fan tools, and free draft tools already exist. Riot's Riftbound program is the only documented route to an approved paid tool.

## The three options

1. **Hobby that pays its bills** (recommended now): tips through Ko-fi, a supporter badge granted by hand, donor cosmetics with original art, and a public cost page.
2. **Modest income:** light ads on browsing pages only (cube library, deck pages, leaderboards, replay lists), plus a premium tier of about €4–5 that removes ads and adds conveniences. Never sell anything that helps in play. Before starting this one:
   - rewrite the privacy policy, which currently promises no ads;
   - add an EU consent banner;
   - get legal advice.
3. **Platform test for Riftbound groups:** an optional 30-day test, done by hand, with no multi-tenant build up front.

Decision gate: measure daily users and tips for 60–90 days after Stage 0. Below about 1k daily users, stay on option 1. With real traffic, choose option 2 deliberately or stay on option 1.

## Stage 0 (needed under any option)

- [ ] Add a visible link to the source of the deployed duel engine. The AGPL requires it whether or not the site earns money.
- [ ] Replace the two coin faces that use card art: `packages/web/public/duel/coin/89631139.webp` and `46986414.webp`.
- [ ] Update the metadata description at `packages/web/app/layout.tsx:29`.
- [ ] Remove card images from the repository (`docs/design/duel-3d-mode/concept/assets/cards/`), and decide whether the GHCR packages stay public.
- [ ] Turn on analytics once the privacy policy is approved, so the gate has real 30-day active counts.

## How to continue

- Open the artifact and fill in the Decisions section.
- Start a session from this file. Use Codex for research and Sonnet for design work, with Claude orchestrating. Don't use Workflow runs.
- The Stage 0 items are independent and can go out as separate small PRs.
