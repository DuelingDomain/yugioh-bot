# Next Turn: final mock brief (feedback board)

Single source of truth for the hi-fi artboards. Everything a designer needs is in this document. Sample people are invented handles, sample counts are alpha-scale (41 members), and no copy names the card game. The mock "today" is **Fri Oct 30, 2026**, the first week after a soft launch on Mon Oct 26. One artboard (ShippedNotice) is a labelled future sample.

---

## 1. Concept

**Name:** Next Turn

**One line:** The board where players and the team decide, build and ship what Dueling Domain gets next.

**Core idea:** A feedback board works like a game of turns between the players and the team. A player makes a move (an idea or a vote), the team answers it (approve, plan, build, ship), and the board stays alive only while every move gets a visible answer. Next Turn borrows three shapes players already read in every duel: the six-station track at the bottom of the board, the numbered chain (newest link on top), and face-down cards. Together they show where an idea stands and whose move it is without a legend, and every label stays in plain English. Intake is tied to the end of real play, votes come before writing, and shipping hands the turn back to the people who asked.

**Why it fits:** The product principles are "live state is truth", "speed over ceremony" and "draft-room immersion". The board reuses the app's own visual parts (station track, ChainGlyph, gold link roundels, TierLine, floor rows), so it looks native and not like a bolted-on SaaS widget. Progress is set by hand from the owner's existing admin console, as the owner asked, with one action that moves the status and tells followers. The alpha is small and invitation-only, so the design favours one-tap votes, a short owner queue and honest statuses with no dates over volume features.

Rules for using the metaphor:
- Use it in structure and glyphs only.
- No phase codes (DP/SP/M1…), no "Turn N" numbering, no stat-slot votes.
- No "Table talk" for comments, because that name already belongs to the draft room.

---

## 2. Vocabulary

**Section**
- Nav label, page title and route are all **Next Turn**, at `/next-turn`.
- Tagline: "Ideas, votes and what we're building".
- It sits in a new sidebar group, **Community**, after Build and before Admin. Icon: Lucide `Lightbulb`.
- Tabs: **Ideas · Roadmap · Shipped · Yours**.
- Routes: `/next-turn`, `/next-turn/roadmap`, `/next-turn/shipped`, `/next-turn/yours`, `/next-turn/[ref]` (e.g. `/next-turn/NT-117`).
- An item is an **idea** with a short reference, **NT-117**, shown in small type on the detail page and everywhere in admin.

**Statuses.** The six public stations are In review → Open → Planned → Building → Testing → Shipped.

| Status | One-line meaning | Who sees it |
|---|---|---|
| In review | Submitted and face-down until the team reviews it. The author's own Back is already counted. | Author + owner |
| Needs detail | The team asked the author one question. A reply returns it to In review; after 14 days with no reply it becomes Not added, with a soft note. | Author + owner |
| Not added | Not accepted. The author gets a kind one-line reason (already on the board, can already do this + how, it's a bug, out of scope, too vague). | Author only |
| Open | On the board, open for Back/Pass and comments. | Public |
| Planned | The team intends to build it. No date. Votes still order the Planned list. | Public |
| Building | Being built now. Can show build steps ("2 of 4 done") and updates. | Public |
| Testing | Built and switched on for playtesters. "Try it" when you're in. Comments shape the final version. | Public |
| Shipped | Live for everyone and in the Shipped log. Voting freezes. | Public |
| Parked | Not now, with a public reason. Shown face-down. Voting stays open, so demand can bring it back. | Public |
| Won't do | Decided against, with a public reason. Votes freeze; comments stay readable. | Public |
| Merged | Folded into another idea. The URL redirects there and votes move over. | Public (redirect line) |

**Areas.** Each area reuses its nav icon:

| Area | Lucide icon |
|---|---|
| Duels | `Swords` |
| Drafts | `Layers` |
| Tournaments | `Trophy` |
| Ranked | `Medal` |
| Decks & cubes | `Library` |
| Replays & watching | `MonitorPlay` |
| Community | `Users` |
| App | `LayoutDashboard` |

**Votes**
- ▲ **Back** (+1) or ▼ **Pass** (−1), one per member per idea. Tap again to clear; you can switch any time until Shipped or Won't do.
- "Pass" borrows passing priority, so it reads as "not for me".
- First-visit legend: "▲ Back = I want this · ▼ Pass = not for me".
- Rows show a net numeral plus a 24×2px back/pass split line. Exact counts ("14 back · 1 pass") appear on hover, long-press and the detail page.
- After a Pass, three optional reason chips appear: **Not for me · Would hurt play · Can already do this**. They are shown only as counts. Three or more "Can already do this" raise an owner-only discoverability flag.
- Backing an idea also follows it. Passing does not. Follow is also a separate toggle.
- Every vote weighs the same, whatever the voter's tier.
- Team members don't vote on team-authored ideas.
- **Played gate:** you can vote or post only after you've finished at least one duel, draft or tournament match. Spectators, practice-only and brand-new members can read but not vote.
- Sorts:
  - **Top:** Wilson lower bound of back share, so 11–0 ranks above 12–1 and a 2–0 idea can't outrank a 38–4 one. Caption: "Top weighs how many voted and how they split."
  - **Rising:** backs in the last 7 days.
  - **New:** by approval time.
  - **Split:** at least 10 votes with at least 30% passes.

**Official team posts**
- Team members carry a gold **Team** tag.
- A team comment can be pinned as **Team answer** (gold left rule, soft gold tint).
- Progress posts are **updates**: numbered links in the idea's chain, typed Update, Status change or Shipped, newest on top, with an optional PR chip.
- Team reasoning for Parked and Won't do, and the pinned board line, are set in **Newsreader italic**.
- Pinned board line: "Votes set priority. The team makes the call, and every decision gets a reason here."
- Credit: **Idea by vexmoth** on the idea page and shipped line (the author's "Show my name on this idea" toggle, on by default), and **Backed early** (you backed it while it was Open), shown to you and as a count on shipped lines. Backers are anonymous counts.

**Umbrella ideas and parts**
- A big feature, such as Ranked, is an umbrella whose **parts** are ordinary ideas with a parent link.
- The umbrella has no vote of its own. It shows its part count, the total backs across parts and each part's status.

---

## 3. Lifecycle and admin control

### State machine

```
 player submits ──► In review ──approve──► Open ──► Planned ──► Building ──► Testing ──► Shipped (votes freeze)
                     │   ▲   │              │  ▲        ▲ any station, either direction, owner only ▲
                 Ask │   │   │ decline      ▼  │
                     ▼   │   ▼           Parked (voting open) ── can return to Open/Planned
                Needs detail  Not added  Won't do (frozen, reason required)
           (no reply 14d → Not added)
 duplicate at compose ("Back this + add my note") or owner Merge ──► Merged (redirect to target)
 team ideas skip review and start at Open, Planned, Building or Testing
```

**Who moves what**
- **Author:** submits; edits freely while In review; can withdraw; replies to Needs detail; toggles "Show my name".
- **System:** sets In review on submit; sets Merged when the author picks "Back this + add my note"; auto-declines after 14 days in Needs detail; freezes votes at Shipped and Won't do.
- **Owner:** everything else, by hand. In v1 nothing moves automatically from GitHub or deploys.

**Edits after approval**
- An author's edit to an Open idea becomes a *suggested edit* in the owner's queue. The public keeps seeing the old text until the owner approves it.
- Approved edits and owner retitles show **"Edited · Oct 27"**, plus a small system line in the chain ("Title edited by the team · was 'Small-screen card details'").
- The owner can **Return to review** (unpublish): the idea hides and its votes are kept.

### Where it lives in the admin console

- A seventh view, **Ideas**, after Insights. It uses key **7**, the rail hint becomes "Press 1–7 to switch views", and the rail shows a gold count pill for waiting ideas.
- Hashes: `#ideas` (Queue), `#ideas-board`, `#ideas-shipped`, `#ideas-flags`, `#ideas-board/NT-117` (idea editor).
- Segments: **Queue · Board · Shipped log · Flags**.
- The phone bottom bar grows to **seven labelled tabs** of about 54px each at 390px, keeping the icon plus 10.5px label (Overview, People, Duels, Waitlist, Health, Insights, Ideas). No tab is renamed or moved.
- Overview's Needs attention gains rows for:
  - "4 ideas waiting · oldest 2d"
  - stale Building/Testing items ("no update for 10 days")
  - discoverability flags
  - suggested edits
- Every request rechecks OWNER_USER_IDS, Origin and guild scope, and returns private/no-store responses.
- **Team** in v1 means the owner allowlist only.

### Moving progress: "Move and post"

1. In the idea editor or the Board pane, the owner clicks a station on the status track (or steps with `[` and `]`).
2. An inline composer opens: "Move to Building · note for followers", pre-filled "Started building.", with a **Notify N followers** toggle that is on by default for status changes.
3. **Move and post** writes the status and a Status change link in one transaction.
4. Guard: a warning (not a block) when 3 ideas are already Building: "3 of 3 Building slots in use. Moving this makes 4."

### Progress model

There are no percentages and no dates on statuses. Progress has three parts:

- **Status** on the six-station track.
- **Build steps:** an optional public checklist of up to 6 steps, shown only while an idea is Building or Testing ("2 of 4 done"). Each step can carry a PR.
- **Updates:** numbered chain links, up to 600 characters, with an optional PR number (validated against the public repo, e.g. "#459 · merged") and an optional "Try it" route for Testing. The notify toggle is off by default for minor updates.

An owner-only **stale nudge** flags a Building or Testing idea with no update for 10 days: "Post an update or Park it". The public never sees a timer.

### Shipping

1. The owner moves an idea to Shipped. The composer then requires a **shipped line**, one player-facing sentence of at most 120 characters that passes the name check.
2. Options:
   - "Add to this week's Shipped log (Nov 2–8)" (checked)
   - "Notify 13 followers" (checked)
   - "Ask backers 'Working well?' after 3 days" (checked)
3. Publishing freezes votes, sends "It shipped" to backers and followers (Yours, the nav dot, the dashboard strip), queues the line in the weekly log draft and arms the follow-up prompt. The follow-up shows in each backer's next end-of-activity slot, at least 3 days later: **Working well / Needs work**. A Needs work line becomes an "After ship" comment that the owner can turn into a follow-up idea.

**Weekly Shipped log** (admin Shipped log segment)
1. "Draft from merged PRs" lists PRs merged since the last entry through the web-side GitHub client. CI, infra and test-only PRs start unchecked and dimmed.
2. Each line is pre-filled from a new **"Player note:"** line in a new PR template, or from the PR title as a fallback.
3. The owner can link a line to an idea, with a checkbox "Mark Shipped on publish" for linked Building/Testing ideas.
4. **Publish week** writes the entry. Lines that fixed a bug report send its reporter "Report #41 is fixed and live" (phase 2).

**GitHub** (optional, never blocking)
- At Planned, the owner can **Create GitHub issue** (labels `enhancement`, `from-app-ideas`, `area:*`; redacted body with problem, backer count and the NT ref) or **Link #N**.
- The local status stays authoritative. On failure, the error shows and the issue retries.
- Automatic Building/Shipped from PRs or deploys is phase 3, out of v1.

### Rules the mocks must respect

- **Guild scope:** ideas, votes, comments, follows and seeds are per `DISCORD_GUILD_ID`.
- **Name check:** at approval, on team updates and on shipped lines, any term naming the card game (or a third-party product) is highlighted, and the owner must rewrite it inline before publishing.
- **Account deletion:** votes are removed (counts drop), comments are removed ("Comment removed"), authored ideas stay with the credit cleared ("Idea by a former member"), and follows are dropped.
- **merge-users folds:** one vote per idea (the most recent wins), follows merged, credits moved to the surviving account.
- **Limits** (stored in SQLite): 3 ideas a day, 20 comments a day, 60 votes an hour.
- **Vote-burst rule:** 8 or more votes on one idea within 15 minutes, from accounts under 7 days old or with fewer than 3 activities, goes to Flags with a one-action "Void burst".
- **Moderation:** comments post at once; two flags collapse a comment; Hide, Pin as Team answer and Lock comments take one action each; board-mute lasts 7 or 30 days.
- **Liveness:** pages poll every 30 seconds and pause while hidden, and votes update optimistically. There is no new ws room in v1.
- **Gate:** `NEXT_TURN=1` on web and worker, off by default, for a dark launch.

**Phases:**
- **v1:** board, owner queue, manual status, seeds and backfill, intake prompts, Shipped log composer.
- **v2:** follow-ups and bug-report "fixed and live".
- **v3:** GitHub/deploy automation.

---

## 4. Intake loop

### Global cadence

- Prompts are stored server-side, so they follow the member across devices.
- The first prompt waits until a member's **3rd finished activity**. After that, at most **1 per day and 3 per week**.
- **7 days of silence after 2 dismissals in a row.**
- Never shown between games of a series. The series end replaces the per-game prompt.
- Never shown after interrupted, cancelled or timeout endings; those show "Something broke? Report bug" instead.
- Never shown to spectators.
- **Stop asking me after games** is a toggle in Account.
- A vote or post in the last 72 hours counts as answered.
- There is no win/loss-based suppression, so the sample stays unbiased.

**Prompt UI** (all moments)
- An unboxed block after the existing actions, under a 1px `--rule-lo` hairline, at most 560px wide.
- No modal, no autofocus, no layout shift above the actions. Exit, Replay and Close stay first in the DOM.
- Pattern, vote first:
  1. A Newsreader italic head with a quiet "Not now" on the right.
  2. Two 48px rows of matched Open ideas with one-tap ▲. After a tap the row shows "Backed · Undo".
  3. A 44px "Something else…" line that opens the composer with context attached.
- Matching uses area and mode/format.
- **Situational variant:** the owner can attach one yes/no question to an idea. Yes = Back, No = Pass.

### Moments

| Moment | Exact component / slot | Prompt content | Extra cap |
|---|---|---|---|
| Duel result (1v1, Tag, FFA, incl. vs bot) | `DuelResultScreen`, `components/duel/duel-result.tsx`, after the actions row (Exit duel / Back to tables, Watch replay, View board) | "Make the next one better" + 2 matched ideas. Situational variant: "Ranked queue is on Next Turn. Would you have queued for a ranked match just now?" with "Yes, I'd queue" / "Not for me". After a vs-bot game the matched idea is "A practice bot that plays a real deck". | vs-bot: 1 per 7 days |
| Mid-duel thought | Duel Settings › Feedback (`bug-report-menu-button.tsx`), new sibling "Jot down an idea" next to "Report bug" | Sheet: "Jot it down" / "We'll bring it back after the duel. Nothing is sent now, and your clock keeps running." / "Save for after". The result screen then shows the saved note pre-filled with "Send for review". | Uncapped, outside the cap |
| Series end (Bo3, rated or casual, tournament series) | `SeriesResult` in `duel-result.tsx`, below the final record. Never in `between-games.tsx`. | Same block; rated series prefer Ranked parts | Once per series |
| Draft complete (in room) | `components/draft/room/finale.tsx`, below the actions (Create tournament / View your deck / Export YDK / Back to drafts / Close) | "How did the table feel?" + 2 Drafts/Tournaments ideas | Once per draft |
| Completed draft summary (fallback) | `draft-summary-view.tsx`, after "Your deck is saved", before Your pool; only if the finale was never seen | Same | Never twice for one draft |
| Tournament closed (participants) | `tournament-sheet.tsx`, between the champion/closing note and final standings, below outstanding report confirmations | "What should the next one do differently?" + Tournaments ideas | Once per tournament |
| Replay reaches its last frame | `replay.tsx` / `replay-tag.tsx` / `replay-ffa.tsx`, one line below the transport. Not for one-frame fallbacks or replay forks. | "Missing something in replays?" + 1 idea | 1 per week |
| Rank-up on own profile | `profile-header.tsx`, under the tier row after "Up to Gold" settles | "You reached Gold. Ranked has 6 parts up for votes." + the top 2 Ranked parts with ▲. Votes only, never a post. | Once per promotion; exempt from the weekly count, still 1 per day |
| Deck or cube import success | `import-panel.tsx` / `cubes-library-list.tsx`, a quiet line below the success links | "Building decks a lot? Back what's next" → links to the Decks & cubes area. No input. | 1 per 14 days |
| Report bug crossover | `bug-report-dialog.tsx` write step: request wording ("add", "would be nice", "could you", "option to") | StatusLine: "Sounds like an idea? Post it to Next Turn". Carries the text over. | User-started |
| Shipped follow-up (backers) | The next slot of any moment above, 3 or more days after ship | "Card details that fit on a phone shipped on Nov 12. You backed it. Working well?" with Working well / Needs work | 1 per 7 days, top priority |
| Always on | Next Turn page bar "Suggest an idea"; Duel Settings "Jot down an idea"; the **Report bug FAB stays unchanged** | n/a | Limits only |

### Context captured

- **Public chips:** mode (Standard/Domain) and format (1v1/Tag/FFA3/FFA4); draft kind (Cube/Theme) and player count; tournament format and size; "best of 3".
- **Owner-only:** duel reference (so the owner can watch the replay), ranked or casual, engine family, turn count, ending kind, duration bucket (labelled as including lobby time), draft or tournament reference.
- **Never captured:** win/loss, opponent, deck contents, card names.
- **Composer privacy line:** "Others see the mode and format only. The team also sees which duel, so they can watch the replay." The chip is removable (×).
- **Analytics:**
  - Events: `feedback_prompt_shown` / `_answered` / `_dismissed` with moment kind (a new allowlisted enum), mode/format and counts.
  - Counts only for submitted and shipped ideas.
  - No per-vote events, titles, areas or text.

### A new post becomes a vote on a duplicate

- The composer runs a precheck after 3 title words (250ms debounce), using the bug-report similarity matcher (`rankCandidates`, moved to shared).
- It shows up to 3 matches **including closed ideas**:
  - Open/Planned/Building/Testing: **"Back this + add my note"** records a Back and posts your text as a comment there.
  - Shipped log match: "Already shipped · Sept 28 – Oct 4" + "How to".
  - Parked: shows the reason + "Back it anyway".
  - Won't do: "Decided against" + the reason.
- "Mine's different" continues.
- Bug-shaped text ("crash", "stuck", "broke") or ruling-shaped text ("didn't negate", "resolved wrong", "should have triggered") shows a warn StatusLine: "Sounds like a rules problem. Report it as a bug with this duel attached so the team can replay it." with **Report bug instead**, which keeps the text.
- Body rule as in bug reports: at least 20 characters and 4 words.
- In admin, **M** merges with a pre-filled similarity match. Votes combine and the most recent vote per member wins. The author sees "Merged into Ranked queue. Your vote moved there."

---

## 5. Seed content

### 5a. The rank system (umbrella, NT-101)

**Ranked: queue, placements and seasons** · Ranked · Team · Open (umbrella) · 6 parts · 14 comments

Today:
- Everyone starts at 1000 Elo, which is Silver.
- K = 32, so an equal match moves about ±16.
- Tiers: Bronze < 900, Silver 900–1099, Gold 1100–1349, Platinum 1350–1599, Diamond 1600+.
- **One rating covers Standard and Domain.**
- Rated games happen **only by direct challenge** (human 1v1 Bo3).
- Seasons are started by hand and **never reset Elo**.
- The leaderboard sorts by **winnings, not rating**.

What the parts add on top:

| Ref | Part | What it adds | ▲ | ▼ | Comments |
|---|---|---|---|---|---|
| NT-102 | Ranked queue | "Find ranked match" pairs you near your rating for a Standard or Domain 1v1. Search starts at ±100 and widens to ±300 over a minute. Bo3 with side decking, the 180s ranked time bank, and a live "3 waiting · Standard" count. | 14 | 1 | 5 |
| NT-103 | Placement series | Your first 5 rated series in a format use K 48 instead of 32. "Placement 3/5" shows until they're done. | 9 | 2 | 2 |
| NT-104 | Separate Standard and Domain ratings | Each format gets its own rating and tier on profiles and the leaderboard. | 11 | 3 | 4 |
| NT-105 | Seasons with a soft reset | Automatic rollover every 8 weeks. Ratings move halfway back to 1000: 1700 Diamond → 1350 Platinum, 1184 Gold → 1092 Silver. | 7 | 4 | 6 (Split) |
| NT-106 | Season crest and seat frame | Peak tier each season becomes a profile crest and a duel-seat frame for the next season. Cosmetic only. | 8 | 0 | 1 |
| NT-107 | Ladder sorted by rating | Sort the season leaderboard by rating as well as by winnings. | 6 | 2 | 1 |

All parts are Open. A part moves to Planned only if the owner confirms it is true.

### 5b. Other team seeds

† = status needs owner confirmation before launch.

| Ref | Title | Area | Pitch | Status | ▲ | ▼ | 💬 |
|---|---|---|---|---|---|---|---|
| NT-108 | Swiss rounds with a top cut | Tournaments | Play a set number of rounds against people with the same record, then the top 4 or 8 play single elimination. Fits nights too big for round robin and too small for a straight bracket. | Open | 12 | 1 | 4 |
| NT-109 | Friends and playing now | Community | Add friends, see who's online or mid-duel, and watch or challenge them in one tap. Nobody needs to post in Discord to find a game. | Open | 10 | 2 | 3 |
| NT-110 | Share a deck or cube by link | Decks & cubes | Make a read-only page for any deck or cube; anyone signed in can view it and copy it to their library. Private stays the default. | Open | 9 | 1 | 2 |
| NT-111 | Jump in from your own replays | Replays & watching | Stop your replay at the turn it went wrong and play it out from there against the practice bot. Private to you, and it never counts for rank. | Open | 8 | 0 | 2 |
| NT-112 | Quick reactions in duels | Duels | A fixed set of short reactions (gg, gl, nice, thinking…) with a per-table mute. No free-text chat, so there's nothing to moderate. | Open | 6 | 5 | 9 |
| NT-113 | A practice bot that plays a real deck | Duels | Pick a saved deck for the practice bot to pilot instead of plain monsters. Test duel then feels like a real matchup. | Open | 11 | 0 | 3 |
| NT-114 | Draft recap | Drafts | After a draft, step through every pack you saw: what you took, what you passed and who took it next. Good for learning a cube. | Open | 7 | 0 | 2 |
| NT-115 | Inbox for challenges, round calls and updates | App | One place for challenges, "your round is ready", draft starts and news on ideas you backed. Nothing goes by email unless you turn it on. | Open | 8 | 1 | 2 |
| NT-116 | Theme drafts | Drafts | Each player drafts privately from an assigned cube theme. Built and switched off for new games while it's tested. | Testing † | 10 | 1 | 5 |
| NT-117 | Card details that fit on a phone | App | Card text, clock names and lobby wording get cut off on narrow phones. This fixes the four places it happens, together. Steps: 2 of 4. | Building † | 13 | 0 | 6 |
| NT-118 | Readable text everywhere | App | Nothing in the app smaller than 11px, starting with the duel log and card stats. | Planned † | 6 | 0 | 1 |
| NT-119 | Clear, consistent format names | App | Standard, Domain and Genesys read the same on every screen and menu. | Planned † | 5 | 0 | 0 |
| NT-120 | Daily puzzle | Duels | One set board a day, the same for everyone: win this turn with what you have. Reason: "Every puzzle would need building and checking by hand each day. Parked until puzzles can come from real duels." | Parked † | 4 | 1 | 1 |

Theme drafts, Card details, Readable text and Format names come from real current work: the THEME_DRAFTS switch and the planned and under-review items in `docs/roadmap.md`.

### 5c. Player-submitted samples

| Ref | Title | By | State | Detail |
|---|---|---|---|---|
| NT-121 | Rematch button after a casual duel | vexmoth | Open (approved Oct 26) · ▲9 ▼1 · 3 comments | Pitch: "One button on the result screen to run it back with the same opponent and decks." Owner-only flag: "Can already do this ×3". |
| NT-123 | Choose a card sleeve for your decks | kestrel9 | In review · 2d (oldest in queue) | "A few sleeve colors to pick per deck so I can tell my decks apart in the lobby." Context: after deck save · Standard |
| NT-124 | Keyboard shortcuts for Pass and End turn | lumen (the mock viewer) | In review · 1d | "I play on desktop and reach for the mouse every turn. Space to pass would be enough." Context: after duel · Domain · 1v1 |
| NT-125 | pls ranked matchmaking | mossgiant | In review · 6h → duplicate | Closest "≈ Ranked queue · 0.86". After merge: "Merged into Ranked queue. Your vote moved there." |
| NT-126 | My trap didn't negate the attack in the Damage Step | pellucid | In review · 3h → converted | Admin "It's a bug" → author sees "Sent to bug reports with your duel attached (Report #58)." |
| NT-122 | Bring back draft commands in the Discord bot | tidebreaker | Not added (Oct 29) | Reason (author only): "Drafts now run in the app so everyone sees the same live room, and the bot is switched off. We won't bring bot drafting back. The Inbox idea covers 'your draft starts in 5 minutes', so back it there." |

### 5d. Dev updates

Team handle is **kaito · Team**.

**NT-117 Card details that fit on a phone** (Building)
- **3 · Update · Oct 29:** "Clock names now shorten cleanly instead of cutting off mid-word on phones under 400px wide. We're checking it on real phones before it goes out."
- **2 · Status change · Oct 27:** "Moved to Building. Pinned card details already stay put while the board moves; that went out Oct 24. The other three fixes come next." PR chip `#459 · merged`
- **1 · Status change · Oct 26:** "Planned. Several of you hit cut-off card text on phones in the last few weeks."

Build steps:
- ✓ Pinned card details stay put while the board moves (#459, live since Oct 24)
- ✓ Clock names shorten cleanly instead of cutting off (built, checking on phones)
- ○ Clearer lobby wording
- ○ Check on real phones

**NT-116 Theme drafts** (Testing)
- **2 · Update · Oct 28:** "Theme drafts are built and switched off for new games while we test them. Lobbies and decks from earlier theme drafts still work. Playtesters can start one from Drafts › New."
- **1 · Status change · Oct 26:** "Testing. Each player drafts privately from an assigned cube theme. Tell us here what feels off."

**NT-118 Readable text everywhere** (Planned)
- **1 · Status change · Oct 27:** "Planned. Nothing in the app should be smaller than 11px. We'll start with the duel log and card stats."

**NT-101 Ranked** (umbrella)
- **1 · Update · Oct 26:** "What ranked does today: everyone starts at 1000, which is Silver, and a rated series moves you about 16 points against an equal opponent. Rated games only happen when you challenge someone directly, and seasons never reset ratings. We split the rest into six parts so you can vote on each. We'll build the most-backed part first and post every step here."

### 5e. Shipped log (real, backfilled)

Source: local `main` history, verified merges. Backfilled weeks carry the caption "Before Next Turn opened, so no ideas or votes are linked."

**Oct 26 – Nov 1 · this week:** nothing yet. This is true as of Oct 30 local main; refresh before building. Use it as the quiet-week empty state.

**Oct 19–25 · 5 changes**
- Search cards by what they do: effects, partners, counters, release dates and format staples. `#412 #414 #421` · Decks & cubes
- See live card statuses, protections and counters on the board. `#465` · Duels
- Get legal deck suggestions and start a Test duel straight from the editor. `#413 #411` · Decks & cubes
- Hosts can remove players before a table starts, and replays load faster. `#429 #416` · Duels
- Fixed: decision clocks, Damage Step timing, card sorting and multiplayer LP effects. `#455 #456 #457 #458 #464` · Duels

**Oct 12–18 · 3 changes**
- Import decks in bulk, with better previews and an editor that fits your screen. `#335 #347 #366` · Decks & cubes
- Build and play Genesys decks with point budgets. `#388` · Decks & cubes
- Replay older games even after engine updates. `#338` · Replays & watching

**Oct 5–11 · 2 changes**
- Make drafts and tournaments open or private, with invitations. `#304 #305` · Drafts
- Follow each chain link as it resolves, with a table log and negation marks. `#263 #294 #328` · Duels

**Sept 28 – Oct 4 · 2 changes**
- Play Tag 2v2 and three- or four-player free-for-all. `#101 #124` · Duels
- Export draft decks and turn a finished draft into a tournament. `#94 #120 #128` · Drafts

---

## 6. Visual system

### Player app tokens (SheetRoot `.ms`)

| Token | Value | Use |
|---|---|---|
| `--floor` | `#050811` | page body background |
| `--ground` | `#070b15` | deepest surfaces, node centers |
| `--panel` | `#0a1120` | sidebar, page bar, dialogs |
| `--panel-2` | `#0e1729` | inputs, FAB |
| `--panel-3` | `#132037` | face-down card fill, tooltips |
| `--ink` / `--ink-2` / `--ink-3` / `--ink-4` | `#efe7d5` / `#c3bba8` / `#958f81` / `#5f5c57` | text ramp |
| `--pen` / `--pen-ink` / `--pen-fill` | `#9b7eff` / `#c6b6ff` / `#5733d1` | violet: you, selected, primary |
| `--pen-soft` | `rgb(155 126 255 / 0.13)` | selected fill |
| `--chain` / `--chain-ink` / `--chain-soft` | `#e4b64f` / `#f4d690` / `rgb(228 182 79 / 0.11)` | gold: chain, Team, Testing |
| `--gold` (rule gold) / `--gold-ink` | `rgb(181 153 99)` / `#dcc58f` | hairlines, Planned |
| `--rule` / `--rule-hi` / `--rule-lo` | `rgb(181 153 99 / .34)` / `/ .646` / `/ .17` | borders |
| `--loss` / `--loss-ink` / `--loss-soft` | `#e45a4d` / `#ff9489` / `rgb(228 90 77 / .1)` | Pass, Won't do |
| `--ok` / `--ok-soft` | `#86cfa1` / `rgb(134 207 161 / .09)` | Shipped |
| `--warn` / `--warn-ink` | `#ee9a3a` / `#ffc079` | Needs detail, warn lines |
| `--live` | `#ff5448` | live lamp |
| `--beam` | `198 182 255` | row hover border `rgb(198 182 255 / .3)` |
| Tier colors | Bronze `#d6a06a`, Silver `#cbd5e1`, Gold `#f5c451`, Platinum `#7dd3fc`, Diamond `#dbe6ff` | gems, TierLine |
| Card kinds (fan placeholders) | monster `#e3a466`, spell `#52c3a9`, trap `#d684bd`, extra `#a990ff` | 4px top band on blank cards; no real card art |

**Fonts** (Google Fonts)
- **Oxanium** 600: page title 19px (17px under 760px), section heading 21px, idea title on detail page 26px.
- **Sofia Sans Semi Condensed:** all UI and body, 14px/1.45. Row titles 600 17px, nav 500 14.5px.
- **Sofia Sans Extra Condensed** 600: numerals (vote net 22px, counts 28px, PR refs 14px), tabular lining.
- **Newsreader italic:** team reasoning, prompt heads, Team answer label.
- Do not use Russo One or Chakra Petch. They are root fallbacks outside SheetRoot.
- The duel result wordmark is Oxanium 800, and its reason line is Newsreader italic 20–25px `--ink-2`.

### Shell (desktop)

**Sidebar**
- Fixed, 236px wide (68px collapsed), background `--panel`.
- Brand row 67px tall, padding `0 6px 0 20px`: 28px mark and wordmark "Dueling Domain" at 600 16px Oxanium, with "Domain" in `rgb(181 153 99)`. A light rule follows.

**Nav**
- Padding `12px 12px 8px`.
- Group headings 39px tall; label 500 12.5px `--ink-3`.
- Rows: 40px tall, padding `0 12px`, gap 12px, radius 8px, 500 14.5px `--ink-2`, icons 20px `--ink-3`.
- Hover: fill `rgb(255 255 255 / .04)`.
- Active: fill `--pen-soft`, text `--ink`, icon `--pen-ink`, plus a 2px left bar `--pen` inset 9px top and bottom with glow `0 0 8px rgb(155 126 255 / .55)`.

**Order** (new rows marked NEW)
1. Dashboard (`LayoutDashboard`)
2. The live row, between light rules: min 52px, only when data exists
3. **Compete:** Tournaments (`Trophy`), Drafts (`Layers`), Duels (`Swords`), Leaderboard (`Medal`)
4. **Build:** Decks (`Library`), Cubes (`Boxes`)
5. NEW **Community:** **Next Turn** (`Lightbulb`). It shows a 6px `--pen` dot on the right when something you authored, backed or commented on changed.
6. **Admin** (owners only): Admin console (`Gauge`), Card data (`DatabaseZap`), Bug reports (`Bug`)
7. **Foot:** Account (`UserCog`), the account seat (min 56px tall, 36px violet monogram ring "LU", "lumen" above "Gold · 1184"), then Terms · Privacy

**Main area and page bar**
- Main area margin-left 236px.
- Page bar: min 68px tall, padding `12px 28px`, background `--panel`, bottom border 1px `--rule-lo`.
- Title (Oxanium 600 19px) above a sub line (14px `--ink-3`); actions on the right with a 10px gap.
- Body padding `28px 32px 56px`.

### Phone shell (≤820px)

- Sticky top bar 56px tall, padding `0 8px 0 6px`: Menu control, page title, 36px account ring.
- Next Turn pages own their page bar: 56px, padding `8px 16px`, title 17px, Menu appended to the actions. They hide the shell top bar.
- Drawer: `min(320px, 86vw)` wide, scrim `rgb(2 4 10 / .7)`, rows 48px tall with 16px text, the Next Turn dot mirrored on the Menu button.
- Gutters 16px, body padding `20px 16px 48px`, every touch target at least 44px.

### Component recipes

**Buttons** (`sv-btn`)

| Variant | Recipe |
|---|---|
| Base | 40px tall, padding `0 18px`, gap 8px, radius 8px, 600 15.5px, flat with no glow |
| `primary` | fill `#5733d1`, hover `#6642e0` |
| `ghost` | border `--rule`, hover `--rule-hi` |
| `danger` | border `rgb(228 90 77 / .65)`, text `#ff9489` |
| `quiet` | 30px tall, padding `0 12px`, border `--rule-lo`, 500 14px `--ink-2` |
| `big` | 46px tall, padding `0 26px` |
| Focus (all) | outline 2px `#c6b6ff`, offset 2px |

**Chips**
- Base: 24px tall, padding `0 10px`, gap 6px, border 1px `--rule-lo`, radius 999px, 12.5px `--ink-2`.
- Prompt and reason chips use the draft skin: 28px tall, padding `0 11px`, 13.5px, transparent background.

**Status chips.** Each pairs a 14px glyph with a color; never use color alone.

| Status | Glyph | Chip |
|---|---|---|
| In review | mini face-down card | dashed 1px `--rule`, text `--ink-3`, no fill, "In review · 1d" |
| Needs detail | "?" in a circle | border `rgb(238 154 58 / .45)`, text `#ffc079` |
| Open | 8px hollow lamp (inset 1px `--ink-3`) | default chip |
| Planned | 8px ring 1.5px `#e4b64f` | border `rgb(228 182 79 / .4)`, text `#dcc58f`, no fill |
| Building | 8px filled `--pen` lamp with 3px halo `rgb(155 126 255 / .18)` | `chip-pen`: border `rgb(155 126 255 / .45)`, fill `--pen-soft`, text `#c6b6ff` |
| Testing | Lucide `FlaskConical` | `chip-gold`: border `rgb(228 182 79 / .4)`, fill `--chain-soft`, text `#f4d690` |
| Shipped | check stroke 2.4 | `chip-ok`: border `rgb(134 207 161 / .36)`, fill `--ok-soft`, text `#86cfa1` |
| Parked | mini face-down card (solid) | border `--rule-lo`, fill `rgb(239 231 213 / .03)`, text `--ink-3` |
| Won't do | slashed circle | border `rgb(228 90 77 / .4)`, text `#ff9489` |
| Merged | `CornerDownRight` | text `--ink-3`, no border: "Merged into Ranked queue" |
| Split (sort tag) | none | default chip, text `--ink-2` |
| Team | none | `chip-gold`, 20px tall, 600 11.5px "Team" |

**Face-down card**
- Mini: 10×14px, radius 2px, fill `#132037`, 1px border `rgb(181 153 99 / .65)`, inner hairline inset 2px, centered 4px gold diamond (the BrandMark shape).
- Large: 44×62px for the author's In review row.
- Approval flip: one 400ms rotateY, shown to the author on their first view after approval. Instant under reduced motion.

**Vote control**

Desktop column (56px wide, centered):
- ▲ button with a 36×28 hit area, 16px chevron stroke 2 in `--ink-3`.
- Net numeral 600 22px Sofia Sans Extra Condensed in `--ink`.
- ▼ button.
- 24×2px split line: back share `#e4b64f`, pass share `#e45a4d`, empty track `rgb(181 153 99 / .17)`.

States:

| State | Recipe |
|---|---|
| Hover | tooltip in `--panel-3` with a `--rule` border, 12.5px: "14 back · 1 pass" |
| Backed | ▲ filled `#c6b6ff` in a 28px circle (fill `--pen-soft`, border `rgb(155 126 255 / .45)`); numeral `#c6b6ff` |
| Passed | ▼ outlined `#ff9489` in a 28px circle (fill `--loss-soft`) |
| After Pass | popover anchored right: "Why? Optional" + three 28px chips |
| Disabled (played gate) | arrows `--ink-4`; tooltip "Finish one duel, draft or tournament match to vote." |
| Frozen | arrows replaced by a 12px lock; numeral + "backed" caption |

- Phone column: 48px wide with 44px targets.
- Umbrella slot: a 18×24 stacked-cards glyph in `#dcc58f` with the numeral "6" and an 11px "parts" caption.

**Rows** (floor rows)
- Bottom border 1px `--rule-lo`; padding `14px 12px` (phone `10px 4px`).
- Grid: `56px 1fr auto`, gap `0 14px`.
- Title 600 17px `--ink`.
- Pitch 14.5px `--ink-2`, one line (phone: 2-line clamp, 16px title).
- MetaLine: 13px `--ink-3`, dot separators, column gap 11px, holding area icon + name · status chip · Team / "Idea by vexmoth" · "3 comments" · "mostly Standard 1v1".
- Hover: bottom border `rgb(198 182 255 / .3)`.
- Your own idea: fill `--pen-soft`.
- "Since you were here": a 6px `--pen` dot plus "Moved" in 12px `#c6b6ff` at the right end.

**Six-station track** (TierLine anatomy)
- Wrapper 14px tall.
- Track: 1px at top 6px in `rgb(181 153 99 / .34)`; done fill 3px at top 5px in `#e4b64f`, radius 2px.
- Nodes: 10px at top 2px, 2px border, `--ground` center.
  - Done: gold fill.
  - Current: `#9b7eff` fill with glow `0 0 8px rgb(155 126 255 / .55)`.
  - Ahead: border `#5f5c57`.
  - Shipped when done: `#86cfa1`.
- Labels under the nodes: 12.5px; current 600 `--ink`, others `--ink-3`. Dates in 12px `--ink-4`.

**Board station filter**
- Six equal segments, each with a label (12.5px `--ink-3`), a count (600 28px Sofia Sans Extra Condensed) and a caption (12px `--ink-4`).
- Selected: `--pen-soft` fill + 2px `#9b7eff` underline.
- Segment divider: 1px `--rule-lo`.
- Off-track piles (Parked, Won't do) sit to the right as small face-down stacks.

**Chain (updates)**
- Heading: ChainGlyph, 16px gold, two interlocked rounded rects rotated −40°, stroke 2.8.
- Rows: padding `10px 0`, separated by `rgb(228 182 79 / .12)`.
- Roundel: 21px circle, 1.5px border `#e4b64f`, 700 14px `#f4d690` numeral. Shipped links use a `#86cfa1` border.
- Eyebrow 12.5px: type in `#f4d690` 700 ("Update", "Status change", "Shipped"), then "· kaito · Team · Oct 29" in `--ink-3`.
- Body 15px/1.55 `--ink`.
- PR chip: default chip with numerals font, "#459 · merged".
- System lines (edits): 12px `--ink-4`, no roundel.

**Team answer.** 2px left border `#e4b64f`, fill `--chain-soft`, padding `14px 16px`, label "Team answer" in Newsreader italic 15px `#f4d690`.

**Tabs** (`.tab`)
- 44px tall, padding `0 14px`, 14.5px `--ink-3`.
- Selected: `--ink` with a 2px `--ink` underline inset 12px.
- Row bottom border `--rule-lo`.
- The Yours tab carries a 6px `--pen` dot.

**Segmented control** (`.seg`)
- Border 1px `--rule`, radius 8px; buttons min 36px tall, padding `0 16px`, 14.5px.
- Pressed: 600 weight with `--pen-soft` fill; dividers `--rule-lo`.

**Inputs**
- 42px tall, padding `0 12px`, border 1px `--rule-lo`, radius 7px, fill `#0e1729`, 15px.
- Focus: border `#9b7eff` + shadow `0 0 0 3px rgb(155 126 255 / .22)`.
- Labels 12.5px `--ink-3`, margin-bottom 6px. Textarea uses the same recipe at 96px tall.

**StatusLine.** Unboxed, top border 1px `--rule-lo`, padding-top 10px, 14.5px. Tones: neutral `--ink-3`, ready `#f4d690`, warn `#ffc079`, block `#ff9489`.

**Dialog** (`ui/Sheet`, explicit tap only)
- Fill `--panel`, border 1px `--rule`, radius 12px, padding 24px, scrim `rgb(2 4 10 / .7)`.
- Phone: bottom sheet with top radius 16px, keyboard-safe.

**Report bug FAB.** Unchanged: 32px pill, padding `0 12px 0 10px`, fill `#0e1729`, border `--rule-lo`, 500 13px `--ink-3`, Bug icon 16px, shadow `0 6px 18px -6px rgb(0 0 0 / .7)`, bottom-right.

**Empty states**
- Large: title 600 `clamp(24px, 3.4cqi, 32px)` Oxanium, lede max 56ch at 1.55 line-height.
- Small: one StatusLine. Never ghost cards.

### Duel result overlay

- Column 820px wide, centered, fixed fullscreen.
- Actions: grid of columns up to 200px wide, gap 12px; buttons min 52px tall, radius 10px, 600 16.5px.
  - Primary: gradient `#6a48e6 → #5733d1`, border `#9b7eff`.
  - Secondary: border `rgb(181 153 99 / .65)`, hover gold.
  - Quiet: `--ink-3`.
- The prompt block sits 28px below the actions under a 560px-wide hairline in `rgb(181 153 99 / .17)`.

### Admin console (its own look; never mix it with the player tokens)

**Palette**

| Token | Value |
|---|---|
| `--bg` / `--bg2` | `#08090b` / `#0c0d10` |
| `--hover` / `--sel` | `#121418` / `#16191e` |
| `--line` / `--line2` | `#1a1c21` / `#262930` |
| `--t1` / `--t2` / `--t3` / `--t4` | `#f3f3f1` / `#a8abb2` / `#6d717a` / `#43474f` |
| `--good` / `--warn` / `--crit` / `--info` | `#3fd28a` / `#f2b443` / `#ff6868` / `#8fb3ff` |
| `--gold` / `--goldDim` | `#e3c27a` / `rgba(227,194,122,.32)` |

**Fonts:** Schibsted Grotesk 400–700 for body and headings (base 15px/1.45); Martian Mono 400/500 for labels, counts and refs.

**Rail**
- 252px wide, fill `--bg2`, right border `--line`, padding `24px 16px 20px`.
- Brand: 26px gold diamond mark, "Dueling Domain" 600 15.5px, sub "ADMIN CONSOLE" mono 9.5px tracked `--t3`.
- Nav rows: 48px tall, radius 10px, 500 15.5px `--t2`, 20px icons at stroke 1.6.
- Current row: `--sel` fill with a 3px gold bar at the left edge.
- Count pill: mono 11.5px, gold fill, text `#17130a`.
- Rail hint: "Press 1–7 to switch views", with 10.5px mono keys.

**Main and headers**
- Main area: radial gold glow `rgba(227,194,122,.055)` over `--bg`; content max 1560px, padding `44px 64px 96px`.
- Header: mono 11px tracked uppercase eyebrow `--t3`, title 600 46px with tracking −.038em, description 16.5px `--t2`.
- Section headings: 600 21px, 60px above.

**Tables and detail pane**
- CSS-grid rows: gap 20px, padding 14px vertical; header row in 10px mono uppercase `--t3` with .12em tracking.
- Hover `--hover`. Selected: `--sel` + a 3px gold edge.
- Detail pane: sticky, border-left `--line`, padding-left 44px, h3 600 30px.

**Controls and parts**
- Buttons: 38px tall, radius 9px, border `--line2`, 500 14px. Primary is off-white `#f3f3f1` with `#0a0a0b` text; danger is `--crit` text with border `rgba(255,104,104,.4)`; small is 34px.
- Tags: mono 10px uppercase, border `--line2`, radius 6px, tones gold/warn/crit.
- Seg: 3px padding, radius 10px, 32px buttons; pressed `--sel`; counts in mono 11px.
- Avatars: 36px, `oklch(.43 .085 hue)` with initials.
- Toast: off-white pill at bottom center, 500 14px.
- Charts: thin SVG lines.
- Inline confirm (Waitlist pattern): the row's buttons turn into the question "Approve lumen's idea?", then [Cancel] [Approve], then "Approving", then a result line and a toast.

**Phone (≤760px)**
- Rail hidden; rows reflow vertically; the detail pane becomes a bottom sheet (`--bg2`, top radius 18px).
- Tab bar: 64px tall, fill `rgba(12,13,16,.94)` with blur, top border `--line`, now 7 columns.
- Tabs: icon 22px + 10.5px label in `--t3`; current `--t1` with a 2px gold top marker.
- Badges: mono 9px; gold for waiting counts.

### Accessibility (applies everywhere)

- **Vote buttons:** `aria-pressed`, labels "Back: Ranked queue" / "Pass: Ranked queue". The numeral is `aria-hidden` and paired with visually hidden text "13 net, 14 back, 1 pass".
- After a vote, a polite live region announces "Backed Ranked queue. 15 back, 1 pass."
- **Row focus order:** Back → Pass → title link → (umbrella) "Show parts". Reason chips come next in DOM order after Pass.
- **Station filter:** a radio group with a roving tabindex and arrow keys; labels such as "Open, 15 ideas". Tabs are a tablist.
- **Prompts:** never take focus; "Not now" is a real button; reduced motion removes slides and the flip.

---

## 7. Artboards

Every desktop page is 1440 wide with the 236px sidebar (Next Turn active unless noted) and the `lumen · Gold · 1184` seat. Phone frames are 390×844 with a 47px top safe area and a 34px home indicator. State insets sit to the right of the main frame, 48px apart, each with a 12px `--ink-3` caption naming the state.

### 1. Main.dc.html: the main board
**Desktop page, 1440 × 2100.** Shows a populated, honest board where members scan, back or pass, and see that things are moving.

**Page bar and tabs**
- Title "Next Turn", sub "Ideas, votes and what we're building".
- Actions: ghost "How it works", primary "Suggest an idea" with a Plus icon.
- Tabs: **Ideas** (selected) · Roadmap · Shipped · Yours•

**Body, top to bottom (full width)**

1. **"Since you were here · Tuesday"** strip with a quiet "Mark as seen" on the right. Two StatusLine rows, each with a pen dot:
   - "Theme drafts moved to Testing. You backed it." + link "Try it"
   - "Team update on Card details that fit on a phone: clock names now shorten cleanly." + link "Read"
2. **Station filter**, full width, six segments:

   | Segment | Count | Caption |
   |---|---|---|
   | In review | 1 | "yours, face-down" (mini face-down glyph) |
   | **Open** (selected) | 15 | "open for votes" |
   | Planned | 2 | none |
   | Building | 1 | none |
   | Testing | 1 | none |
   | Shipped | 0 | "12 changes in the log" |

   Off-track to the right: face-down stack "Parked 1", then "Won't do 0".
3. **Pinned line:** gold 2px left rule, Newsreader italic 16px `--ink-2`: "Votes set priority. The team makes the call, and every decision gets a reason here." + link "How Next Turn works".
4. **Toolbar**
   - Seg **Top** · Rising · New · Split, with caption "Top weighs how many voted and how they split."
   - Search input 240px, placeholder "Search ideas".
   - Area chips below: All (`chip-pen`) · Duels · Drafts · Tournaments · Ranked · Decks & cubes · Replays & watching · Community · App, each with its 14px icon.

**Main column (788px)**

Header "Open for votes" (Oxanium 21) + count "15". Right-aligned legend: "▲ Back = I want this · ▼ Pass = not for me".

Rows in Top order:

| # | Vote state | Title | Pitch (one line) | Meta |
|---|---|---|---|---|
| 1 | **11**, hover state with tooltip "11 back · 0 pass" | A practice bot that plays a real deck | "Pick a saved deck for the practice bot to pilot instead of plain monsters." | Duels · Open · Team · 3 comments · mostly Standard 1v1 |
| 2 | Umbrella slot "6 parts" | Ranked: queue, placements and seasons | "Ranks exist today. This adds a queue, placement games, separate ratings, real seasons and season rewards. Vote on each part." | Ranked · Open · Team · 14 comments |
| 3 | 8 | Jump in from your own replays | "Stop your replay at the turn it went wrong and play it out from there." | Replays & watching · Open · Team · 2 comments |
| 4 | **11, Backed** | Swiss rounds with a top cut | "Rounds against people with the same record, then a top 4 or 8 bracket." | Tournaments · Open · Team · 4 comments |
| 5 | 7 | Draft recap | "Step through every pack you saw: what you took, what you passed, who took it next." | Drafts · Open · Team · 2 comments |
| 6 | 8 | Rematch button after a casual duel | "One button on the result screen to run it back." | Duels · Open · **Idea by vexmoth** · 3 comments · mostly Domain 1v1 |
| 7 | 8 | Share a deck or cube by link | "A read-only page anyone signed in can open and copy." | Decks & cubes · Open · Team · 2 comments |
| 8 | 7 | Inbox for challenges, round calls and updates | "One place for challenges, round calls, draft starts and idea news." | App · Open · Team · 2 comments |
| 9 | 8 | Friends and playing now | "See who's online or mid-duel and challenge them in one tap." | Community · Open · Team · 3 comments |
| 10 | **1, Passed**, with the reason popover open and "Would hurt play" selected | Quick reactions in duels | "Short fixed reactions with a per-table mute. No free-text chat." | Duels · Open · Team · 9 comments · Split |

Row 2 is shown expanded. Its sub-rows are indented, each with a 48px vote column:
- Ranked queue · **13, Backed** · Open · 5 comments
- Separate Standard and Domain ratings · **8, Backed** · Open · 4
- Placement series · 7 · Open · 2
- Link "See all 6 parts"

List end: StatusLine "That's every open idea." + link "Suggest one".

**Right rail (320px)**
- **Now building**
  - Building chip · "Card details that fit on a phone" · "Step 2 of 4 · update 1 day ago"
  - Testing chip · "Theme drafts" · "Try it" · "update 2 days ago"
  - Planned chip · "Readable text everywhere" · "planned 3 days ago"
- **Latest updates** (ChainGlyph heading), roundels numbered per idea:
  - ② Card details… · Update · 1d: "Clock names now shorten cleanly on phones under 400px."
  - ② Theme drafts · Update · 2d: "Built and switched off for new games while we test."
  - ① Readable text everywhere · Status change · 3d: "Planned."
- **Last shipped · Oct 19–25:** "Search cards by what they do" #412 · "Live card statuses and counters" #465 · "Deck suggestions and Test duel" #413 #411 · link "See the log"
- **Your backing:** "You backed 5 ideas · 2 moved this week" · link "See Yours"

The Report bug FAB stays bottom-right.

**State insets**
1. Vote-column strip showing all states: default, hover tooltip, backed, passed + reason popover, disabled with the played-gate tooltip, frozen.
2. Station "In review" selected: a large face-down card row "Keyboard shortcuts for Pass and End turn · In review · 1d" with "Only you and the team can see this." and quiet Edit / Withdraw.
3. Station "Shipped" selected with 0 items: "Nothing from the board has shipped yet. The first ideas are in Building and Testing." + link "See the 12 changes already in the log".
4. Search with no results: "Nothing on the board matches 'sleeve'." + primary "Suggest an idea".
5. A new area with zero ideas: "No ideas in Community yet. Be the first." + ghost "Suggest an idea".

### 2. Roadmap.dc.html: roadmap view
**Desktop page, 1440 × 1500.** Answers "what's being developed" with proof, and no dates.

- Tabs: Ideas · **Roadmap** · Shipped · Yours.
- Intro line, 14.5px `--ink-3`: "What's planned, what's being built and what's in testing. No dates on purpose: votes set priority and the team makes the call."
- **Three lanes**, about 360px each, separated by 1px `--rule` lines (no cards). Each lane head is Oxanium 21 with a count and the status chip.
  - **Planned · 2**
    - "Readable text everywhere" · App · 6 backed · "Planned Oct 27" · latest line "Nothing in the app smaller than 11px. Starting with the duel log and card stats."
    - "Clear, consistent format names" · App · 5 backed · "Planned Oct 27" · "Standard, Domain and Genesys read the same on every screen."
  - **Building · 1**
    - "Card details that fit on a phone" · App · 13 backed · pen dot "You backed" · 4-node mini step track "2 of 4 steps" · "Update 1 day ago: Clock names now shorten cleanly…" · PR chip "#459 · merged".
    - Quiet 2px `--pen` left tick. No progress bar.
  - **Testing · 1**
    - Lane note: "Built and switched on for playtesters. What you say here shapes the final version."
    - Row: "Theme drafts" · Drafts · 10 backed · pen dot · quiet button "Try it" · "Update 2 days ago".
- **Up next by votes** (Oxanium 21), caption "The most-backed open ideas. A signal, not a promise." Three rows with vote columns:
  - Ranked queue (part of Ranked) 13
  - A practice bot that plays a real deck 11
  - Swiss rounds with a top cut 11
- **Parked · 1**, collapsible and expanded:
  - Face-down mini card + "Daily puzzle".
  - Reason in Newsreader italic: "Every puzzle would need building and checking by hand each day. Parked until puzzles can come from real duels."
  - "Voting stays open · ▲ 4 ▼ 1".
- Footer StatusLine: "Shipped so far: 12 changes since Sept 28." + link "See the log".

**State insets**
1. Empty lane: "Nothing in testing right now." (one line, no ghosts).
2. Building row hover.
3. Planned row after the viewer backs it.

### 3. IdeaRanked.dc.html: Ranked umbrella detail
**Desktop page, 1440 × 2700.** Presents the rank system the owner asked for as votable parts, with a personal stake.

**Header**
- Breadcrumb 13px `--ink-3`: "Next Turn › Ranked".
- Title "Ranked: queue, placements and seasons", Oxanium 600 26px.
- Meta: Team · Ranked · "6 parts" · "14 comments" · `NT-101`. Ghost "Following ✓" on the right.

**Main column (788px)**

1. **Umbrella track** across the full main width, with 6 pips under the Open station. Hover a pip to see its tooltip. Caption: "All 6 parts are open for votes."
2. **"What ranked does today"** (Oxanium 19), five lines in 14.5/1.55 `--ink-2`:
   - "Everyone starts at 1000, which is Silver."
   - "A rated series moves you about 16 points against an equal opponent."
   - "Tiers: Bronze under 900, Silver 900–1099, Gold 1100–1349, Platinum 1350–1599, Diamond 1600+."
   - "One rating covers Standard and Domain. Rated games happen only when you challenge someone."
   - "Seasons start by hand and never reset ratings. The leaderboard sorts by winnings."
3. **"Your season, if the soft reset ships"**
   - TierLine across the full width with gem ticks at 900 / 1100 / 1350 / 1600 (11.5px labels) and tier colors.
   - The fill runs in Gold `#f5c451` to 1184.
   - Violet marker "You 1184 · Gold".
   - Dashed ghost marker at 1092: "Next season you'd start at 1092 · Silver", with a thin curved arrow from 1184 to 1092.
   - Newsreader italic caption: "Proposed: ratings move halfway back to 1000 when a season ends. Too harsh? Pass on Seasons with a soft reset and say why."
   - Small line: "A 1700 Diamond would start at 1350 Platinum."
4. **"Parts · 6"**, caption "Each part has its own vote and status." Six rows, each with a vote column, title, spec line (from 5a) and an Open chip:
   - Ranked queue is **Backed** and expanded with a sketch labelled "Sketch, not built": primary "Find ranked match" + seg "Standard | Domain" + LiveDot "3 waiting".
   - Separate ratings: **Backed**.
   - Seasons: Split chip + "Pass reasons: 3 would hurt play · 1 not for me".
   - Ladder: "1 merged post: 'leaderboard by elo not points' · quietstorm".
5. **Updates · 1:** chain link 1 (the 5d text), eyebrow "Update · kaito · Team · Oct 26".
6. **Comments · 14**
   - Pinned Team answer (kaito): "Votes set priority and the team makes the call. If a part reaches Planned, it'll say so here first."
   - pellucid · Platinum gem · 2d: "Placements please. I started at Silver and it took about 20 series to reach where I actually play."
   - ashfall · Bronze · 1d: "Halfway back to 1000 feels harsh if you only play once a week."
     - Reply, tidebreaker · Gold · 1d: "Maybe a smaller reset for the first season?"
   - lumen (you) · Gold · 3h: "Would the queue have Domain from day one?"
   - Ghost "Show 10 more comments".
   - Composer: 42px input "Add a comment" + primary "Comment", caption "Comments post right away. Keep it kind."

**Right rail (sticky)**
- "Vote on the parts": "55 backs across 6 parts · 12 passes" (numerals) · "You backed 2 parts".
- Follow row: "Following · You'll hear when any part moves."
- "Idea by the team".
- "Where votes came from": "31 of 55 backs came from a result screen · Standard 34 · Domain 21".
- "Related": Swiss rounds with a top cut · Friends and playing now.

**State insets**
1. Pip tooltip: "Ranked queue · Open · 13 net".
2. Viewer with no rated games: TierLine without a marker + "Play a rated series to see where you'd land."
3. Pass reason popover on Seasons.

### 4. IdeaBuilding.dc.html: idea detail with progress, dev updates and comments
**Desktop page, 1440 × 2300.** Shows one idea's real progress, team voice and community input in one column.

**Header**
- Breadcrumb "Next Turn › App".
- Title "Card details that fit on a phone".
- Meta: Team · App · Building chip · 6 comments · `NT-117` · "Edited · Oct 27".
- Track:
  - In review: dim, "Team idea".
  - Open: done, "Oct 26".
  - Planned: done, "Oct 26".
  - **Building: current, violet, "Oct 27"**.
  - Testing and Shipped: ahead.

**Main column**
1. Pitch (15.5/1.55): "Card text, clock names and lobby wording get cut off on narrow phones. This fixes the four places it happens, together."
2. **"Build steps · 2 of 4 done":** checklist rows with ✓ (`#86cfa1`) or hollow nodes; steps as in 5d. Step 1 carries PR chip "#459" and caption "live since Oct 24"; step 2 carries caption "built, checking on phones".
3. **"Updates · 3":** the chain from 5d, newest on top. Between link 2 and link 1, the system line "Title edited by the team · Oct 27 · was 'Small-screen card details'".
4. **"Comments · 6"**
   - Pinned Team answer (kaito, replying to nyx_ra): "Yes, the details sheet will remember where you scrolled. That's part of the panel step."
   - quietstorm · Gold · 2d: "The clock name on my phone cuts to 'Opp…' in Tag games. Glad this is on."
   - nyx_ra · Silver · 2d: "Can the details sheet remember where I scrolled?"
   - vexmoth · Silver · 1d: "Tried it on a small Android. The pinned details are much better already."
   - Composer.

**Right rail**
- Big vote block: "▲ Back 13" (pressed) · "▼ Pass 0", plus "You backed this" and "Voting stays open until it ships."
- "Following · You'll hear about every update."
- "Asked for by 13".
- "Where this came from: 9 of 13 backs came from a result screen · Standard 8 · Domain 5".
- "On GitHub": `#459 · merged · Oct 24`.

**State insets** (header plus vote block each)
1. **Testing, you're in (Theme drafts):** Testing chip + primary "Try it" + "Switched on for playtesters. You're in."
2. **Testing, not in:** ghost "Ask to try it" + "The team adds playtesters by hand. You'll get a note when you're in."
3. **Shipped (sample):** track ends on a green Shipped node; votes frozen ("Voting closed when it shipped · 13 backed"); "Shipped Nov 12 · in the log"; "Idea by the team · 9 backed early".
4. **Won't do:** chip + Newsreader block "We won't add this. It would let rated results be farmed between friends." + "Votes are frozen. Comments stay readable."
5. **Parked:** face-down card left of the title + "Parked · voting stays open".

### 5. Shipped.dc.html: shipped log
**Desktop page, 1440 × 2100.** Answers "what we've been doing" from real history.

- Tabs: Ideas · Roadmap · **Shipped** · Yours.
- Header "Shipped" (Oxanium 21) + sub "Everything that went live, week by week, in plain words. PR numbers link to the public code."
- Area chip filter.

**Left week index (220px, sticky)**
- "Oct 26 – Nov 1 · this week"
- "Oct 19–25 · 5"
- "Oct 12–18 · 3"
- "Oct 5–11 · 2"
- "Sept 28 – Oct 4 · 2"

**Main**
1. **This week:** StatusLine neutral "Nothing has shipped yet this week." + "In progress: Card details that fit on a phone (Building) · Theme drafts (Testing)".
2. Thin pen divider: "You've seen everything below".
3. The weeks from 5e. Each line has an 18px area icon in `--ink-3`, the sentence in 15.5px `--ink`, an area chip and PR chips. The Fixed line carries a small "Fixes" tag.
4. One caption at the start of the backfill: "Before Next Turn opened, so no ideas or votes are linked."

**Right rail:** "Now building" (the same rows as Main).

**State inset, "Sample: a week with board ideas (after launch)"**
- Line: "Card text, clock names and lobby wording fit on narrow phones."
- `chip-gold` "From the board · asked for by 13" · violet "You backed this" · "Idea by the team · 9 backed early" · PR chips.
- Line: "Fixed · 2 reported bugs" with "Your report #41 is fixed and live".

### 6. Submit.dc.html: submit flow with duplicate suggestions
**Desktop page, 1440 × 1100.** The board is dimmed behind a 640px dialog. Turns most new posts into votes on existing ideas.

**Dialog content**
- Title "Suggest an idea" (Oxanium 21) with × on the right.
- Label "What should we add or change?" Input filled "Ranked matchmaking that finds someone near my level", counter "52/80".
- **"Already on the board"** block (appeared after 3 words):
  1. Ranked queue · "part of Ranked" · Open · net 13 · button quiet "Back this + add my note"
  2. Placement series · Open · net 7 · "Back this + add my note"
  3. Link "Mine's different"
- Label "What would it let you do?" Textarea: "So I can play rated games without asking around in Discord first." Hint "At least 20 characters."
- Area chips with **Ranked** selected.
- Context chip "From: Standard · 1v1 duel, just now ×".
- Privacy line, 12.5px `--ink-3`: "Others see the mode and format only. The team also sees which duel, so they can watch the replay."
- Toggle "Show my name on this idea" (on).
- Footer note: "New ideas stay face-down until the team reviews them by hand."
- Buttons: ghost "Cancel", primary "Send for review".

**State insets**
1. After "Back this + add my note": "Backed Ranked queue. Your note is now a comment there." + "See it".
2. Already shipped match (typing "best of three with side decking"): "Already shipped · Sept 28 – Oct 4: challenge someone to a Bo3 with side decking from Duels › New." + "How to".
3. Parked match: "Daily puzzle · Parked" + the reason + "Back it anyway".
4. Rules redirect: warn StatusLine "Sounds like a rules problem. Report it as a bug with this duel attached so the team can replay it." + ghost "Report bug instead".
5. Done: a large face-down card + "Sent. It's face-down under In review until the team looks at it. You'll find it in Yours." + "Back to the board".
6. Played gate: "Finish one duel, draft or tournament match to post ideas."
7. Daily limit: "That's 3 ideas today. Try again tomorrow, or back one that's already up."

### 7. DuelPrompt.dc.html: post-duel prompt on the desktop result
**Desktop page, 1440 × 1000.** The fullscreen DuelResultScreen over a dimmed board (no sidebar visible). Catches signal seconds after play without slowing exit.

**Result (unchanged)**
- Reason in Newsreader italic: "LP reached 0".
- Gold wordmark "YOU WIN".
- Final LP: "lumen 3,100 · quietstorm 0".
- Actions: primary "Exit duel", secondary "Watch replay", secondary "View board".

**Prompt block** (560px, below the hairline)
- Head: Newsreader italic 18px "Make the next one better" · quiet "Not now" on the right.
- Row: ▲ · "Rematch button after a casual duel" · net 8 · Open.
- Row: ▲ · "Quick reactions in duels" · net 1 · Open · Split.
- Line: + "Something else…"
- Caption 12.5px `--ink-3`: "One tap backs it. Nothing is posted for you."

**State insets** (each 560px wide)
1. **Backed:** row 1 reads "▲ Backed · Undo" in `#c6b6ff`.
2. **Situational question:** head "One quick question". Line: "Ranked queue is on Next Turn. Would you have queued for a ranked match just now?" Ghost "Yes, I'd queue" / ghost "Not for me". Answered state: "Counted as a back for Ranked queue. Undo".
3. **Jotted note:** head "You jotted this down during the duel". Input pre-filled "Let me see which of my cards can still respond before I pass". Primary "Send for review", quiet "Discard", privacy caption.
4. **Interrupted:** headline "DUEL INTERRUPTED", reason "This duel ended without a result", actions "Back to tables" / "View board", then warn StatusLine "Something broke? Report bug". No idea prompt.
5. **Duel Settings › Feedback:** h2 "Feedback", buttons "Report bug" and "Jot down an idea". The jot sheet: "Jot it down" / "We'll bring it back after the duel. Nothing is sent now, and your clock keeps running." / input / primary "Save for after". Confirmation: "Saved for after the duel."
6. **Cap reached:** the result with no block and no placeholder.

### 8. DraftPrompt.dc.html: post-draft prompt
**Desktop page, 1440 × 1000.** Draft finale overlay. Draft-specific intake that never competes with Close.

**Finale (existing content)**
- Title "Draft complete", sub "45 cards drafted. Your deck is saved."
- A fan of 7 blank cards with kind-color top bands. Counts "24 monsters · 12 spells · 9 traps".
- Status line: "Create the tournament when you are ready. Saved draft decks are registered for it."
- Actions: primary "Create tournament", then "View your deck", "Export YDK", "Back to drafts", "Close".

**Prompt block** (below the hairline)
- Head: Newsreader "How did the table feel?" + "Not now".
- Context chip "Cube draft · 8 players".
- Row: ▲ · "Draft recap" · 7 · Open.
- Row: "▲ Backed · Undo" · "Swiss rounds with a top cut" · 11.
- Line: "Something else…"

**State insets**
1. **Summary fallback** (`/drafts/[slug]` summary): lead "Finished · Cube · 8 players · ended 9:42 PM · 41 min", "Your deck is saved", then the same block, then "Your pool".
2. **Tournament closed:** champion note "pellucid won the night", then the line "What should the next one do differently?" with ▲ "Swiss rounds with a top cut · 11", then "Final standings".

### 9. PhoneBoard.dc.html: phone board
**Phone 390 × 844.** Fast backing and browsing one-handed.

**Top, in order**
- Page bar 56px: title "Next Turn" (17px); actions: primary small "Suggest" (36px, Plus + label) and a Menu button with a violet dot.
- Tabs (44px, horizontal scroll): **Ideas** · Roadmap · Shipped · Yours•
- One 44px row: "2 updates since Tuesday ›".
- Station chips scroller (36px): In review 1 · **Open 15** (selected) · Planned 2 · Building 1 · Testing 1 · Shipped 0.
- Toolbar: "Top ▾", "All areas ▾", search icon button.

**Rows** (48px vote column, 16px titles, 2-line pitch, 12.5px meta)
- A practice bot that plays a real deck (11)
- Ranked umbrella, collapsed: "6 parts" slot + "Top part: Ranked queue · 13"
- Jump in from your own replays (8)
- Swiss rounds with a top cut (11, Backed)
- Draft recap (cut off at the fold)

The Report bug FAB sits bottom-right above the home indicator.

**State insets**
1. Filter sheet: seg "Top | Rising | New | Split", area chips, primary full-width "Show 15 ideas".
2. Pass reason menu anchored to a row.
3. Drawer open: Community › **Next Turn** row (48px) with its dot.

### 10. PhoneDuelPrompt.dc.html: phone post-duel prompt
**Phone 390 × 844.** The same moment where thumb reach matters most.

- Stacked result: reason "LP reached 0", wordmark "YOU WIN" fitted to width, LP line.
- Full-width 52px buttons: "Exit duel", "Watch replay", "View board".
- Hairline, then the head "Make the next one better" + 44px "Not now".
- Two 48px rows (Rematch · 8, Quick reactions · 1).
- 44px "Something else…"
- Safe-area padding. No autofocus.

**State insets**
1. Backed row: "Backed · Undo".
2. Composer bottom sheet (keyboard-safe): "What should we add or change?" input, chip "From: Standard · 1v1 ×", privacy line, primary "Send for review".
3. Shipped follow-up: "Card details that fit on a phone shipped on Nov 12. You backed it. Working well?" with 44px "Working well" / "Needs work". Needs work expands to "What still gets cut off?" + "Send".

### 11. ShippedNotice.dc.html: "it shipped" notice back to voters
**Desktop page, 1440 × 1500.** Labelled "Sample state · Thu Nov 12". Closes the loop where people already land.

- Sidebar: the Next Turn row shows a violet dot.
- Page bar "Dashboard", sub "Thursday, November 12".
- The existing returning-player grid (Your tournaments / Your standing / Your drafts) with plausible placeholder rows. Unchanged.

**"Next Turn" strip below the grid** (Oxanium 21 + link "Open the board"). Three columns of floor rows with no boxes:

| It shipped | Now building | Your ideas |
|---|---|---|
| Gold-edged block: Shipped chip · "Card details that fit on a phone" · "You backed this with 12 others." · "Shipped Nov 12" · link "See what changed" | Theme drafts · Testing · "Try it" | Keyboard shortcuts for Pass and End turn · Open (approved Nov 2) · "3 new backs" |
| | Readable text everywhere · Building · "Update 2 days ago" | Keyboard shortcuts for Pass and End turn · Open · "On the board since Nov 2" |

**State insets**
1. **Yours tab on phone (390 × 844):**
   - Top "It shipped" block.
   - "Updates": "Theme drafts moved to Testing" · "Team update on Readable text everywhere" · "kaito replied to your comment".
   - "Your ideas" and "Backed" lists.
2. **Author states** (caption "shown to the author only"):
   - Face-down "In review · 1d"
   - "Needs detail: Which actions do you use most?" + Reply
   - "Merged into Ranked queue. Your vote moved there."
   - "Not added" + the bot-drafting reason from 5c
3. **Nothing new:** the dashboard ends at the grid with no strip (caption only).
4. **New player:** "See what's next" with 2 read-only rows (Practice bot, Swiss) and "Finish your first duel, draft or tournament match to vote."

### 12. AdminQueue.dc.html: admin triage queue
**Admin desktop, 1440 × 1100**, plus a phone inset. Clears the morning's submissions in under a minute, mostly by keyboard.

**Rail:** Overview · People · Duels · Waitlist · Health · Insights · **Ideas** (selected, gold pill "4"). Hint "Press 1–7 to switch views".

**Header**
- Eyebrow "IDEAS · 4 WAITING · OLDEST 2D".
- Title "Ideas".
- Description: "Approve what goes on Next Turn, move work along and post progress. Players see an idea only after you approve it."
- Top right: "Live · checks every 30s".
- Seg: **Queue 4** · Board 20 · Shipped log · Flags 0.

**Table** with headers IDEA · FROM · CONTEXT · CLOSEST MATCH · AGE:

| Idea | From | Context | Closest match | Age |
|---|---|---|---|---|
| "Choose a card sleeve for your decks" + its first line | KE kestrel9 · "14 duels · 2 drafts" | tags "after deck save", "Standard" | "No close match" | 2d (warn tag) |
| **Selected:** "Keyboard shortcuts for Pass and End turn" | LU lumen · "31 duels · 4 drafts" | "after duel", "Domain · 1v1" | "≈ Quick reactions in duels · 0.31" | 1d |
| "pls ranked matchmaking" | MO mossgiant · "6 duels · 1 draft" | "after series", "Standard · 1v1 · Bo3" | "≈ Ranked queue · 0.86" + small button "Merge" | 6h |
| "My trap didn't negate the attack in the Damage Step" | PE pellucid · "52 duels" | "after duel", "Standard · 1v1" | crit tag "Looks like a bug" + button "It's a bug" | 3h |

**Detail pane** (selected row)
- h3 title with "Edit" and area select "Duels".
- Full text.
- "Name check: clear" with a good-tone icon.
- Context key/value list (mono labels): MODE Domain · FORMAT 1v1 · RANKED No · TURNS 9 · ENDING LP reached 0 · LENGTH 10–20 min · DUEL "Watch replay ›".
- Author line: "First idea · plays since Oct 3".
- Similar: Quick reactions 0.31 [Merge].
- Actions: [Approve] primary · [Merge…] · [Ask] · [Decline] danger.
- Decline reasons inline: "Already on the board" · "Can already do this" · "It's a bug" · "Out of scope" · "Too vague" + a 200-character note.
- Ask: textarea pre-filled "Which actions do you use most?"

**Legend strip:** "J/K move · A approve · M merge · Q ask · D decline · E edit · Enter confirm".

**Recent decisions**
- ● crit · "tidebreaker · Bring back draft commands in the Discord bot · Not added" · 1d
- ● good · "vexmoth · Rematch button after a casual duel · Approved" · 4d

**State insets**
1. Inline confirm "Approve lumen's idea? It goes on the board as Open." [Cancel] [Approve] → toast "NT-124 is on the board. lumen was told."
2. Overview Needs-attention rows: warn "4 ideas waiting · oldest 2d" + "Open queue"; quiet "1 suggested edit".
3. Name check flagged: the term highlighted as a redacted gold-underlined token labelled "Game name" + "Rewrite before approving" + rewrite input.
4. **Phone (390 × 844):**
   - 7-tab bar with the Ideas badge "4"; stacked rows.
   - Bottom sheet for mossgiant: full text, "≈ Ranked queue · 0.86", full-width 44px primary "Merge into Ranked queue", then "Approve as new", "Decline", reason chips.
   - The next row opens after the toast.

### 13. AdminRoadmap.dc.html: admin roadmap and progress control
**Admin desktop, 1440 × 1500.** Every live idea at a glance; status moves in one action; board health.

**Header**
- Eyebrow "IDEAS · BOARD · 20 LIVE", title "Ideas".
- Seg: Queue 4 · **Board 20** · Shipped log · Flags 0.

**Stats hero** (4 columns, Overview style)

| Stat | Value | Detail |
|---|---|---|
| Waiting | 4 | oldest 2d |
| Building | 1 | of 3 slots |
| Voted this week | 23 | of 41 members |
| Prompts answered | 40% | 17 of 42 shown · 19 dismissed · 1 stopped asking |

**Toolbar**
- Status seg: All 20 · Open 15 · Planned 2 · Building 1 · Testing 1 · Parked 1 · Shipped 0 · Won't do 0.
- Search.
- Primary "New team idea".

**Table** with headers IDEA · STATUS · VOTES (▲/▼) · 7D (sparkline) · TALK · LAST UPDATE · FOLLOWING. Mono group headers:
- **BUILDING · 1**
  - NT-117 Card details… 13/0 · 6 · 1d · 13
- **TESTING · 1**
  - NT-116 Theme drafts 10/1 · 5 · 2d · 11
- **PLANNED · 2**
  - **Selected:** NT-118 Readable text everywhere 6/0 · 1 · 3d · 6
  - NT-119 Clear, consistent format names 5/0 · 0 · 3d · 5
- **OPEN · 15**
  - NT-102 Ranked queue "part of Ranked" 14/1
  - NT-113 Practice bot 11/0
  - NT-108 Swiss 12/1
  - NT-104 Separate ratings 11/3
  - NT-121 Rematch 9/1 + warn tag "Can already do this ×3"
  - NT-105 Seasons 7/4 + tag "Split"
  - "Show 9 more"
- **PARKED · 1**
  - NT-120 Daily puzzle 4/1

**Detail pane** (NT-118)
- Title and mono "NT-118 · App · Team".
- Admin-styled track: done nodes `#e3c27a`; current node `#f3f3f1` with a gold ring; ahead `#43474f`. Stations are buttons. Caption "Click a station to move it. [ and ] step through."
- The composer is open after clicking Building:
  - Label "Move to Building · note for followers".
  - Textarea "Started building. First up: the duel log and card stats, then everything else under 11px."
  - Toggle "Notify 6 followers" (on).
  - Notice "1 of 3 Building slots in use."
  - Preview "Followers see: Readable text everywhere moved to Building."
  - [Cancel] [Move and post].
- Toast "Moved to Building. 6 followers told."

**State insets**
1. Cap warning: "3 of 3 Building slots in use. Moving this makes 4." [Cancel] [Move anyway].
2. Stale nudge in Needs attention: "Theme drafts has had no update for 10 days" [Post update] [Park].
3. **Shipped log segment** (1060px wide)
   - Header "Shipped log · Oct 19–25 · backfill draft".
   - Left, "Merged that week": checkbox rows #412, #414, #421, #465, #413, #411, #429, #416, #455–#458, #464.
   - Dimmed and unchecked: #424 "ci: fast main deploy", #420 "ci: main skip engine", #422 "deploy preflight", and #407/#426 "Discord bot (off)".
   - Center: the five player lines from 5e, editable, each with an idea-link picker and the checkbox "Mark Shipped on publish" (disabled; none linked).
   - Footer: toggle "Tell bug reporters when their fix ships" and primary "Publish week".

### 14. AdminIdea.dc.html: admin idea editor
**Admin desktop, 1440 × 1900.** Status, milestones, the dev update composer, PR links and moderation in one place.

**Header**
- Mono breadcrumb "IDEAS › BOARD › NT-117".
- h3 30px "Card details that fit on a phone".
- Tags "App", "Team", Building tag (info tone).

**Left column (620px)**

1. **Status:** the large clickable track plus off-track buttons "Park" and "Won't do". The current station is Building.
2. **"Post an update"** composer:
   - Seg Update (pressed) / Status change (auto, disabled).
   - Textarea with counter "0/600", placeholder "What changed, in plain words".
   - "Link a PR" input "#" showing validated "#459 · merged · fix/card-inspector-sticky".
   - Optional "Try it route" (disabled until Testing).
   - Toggle "Notify 13 followers" (off for updates).
   - Name check "clear".
   - Live preview of the public chain link (roundel ④, eyebrow "Update · kaito · Team · now").
   - Primary "Publish update".
3. **"Build steps · shown as 2 of 4 done":** 4 rows with drag handle, checkbox, text, optional PR field and remove; "Add step" (maximum 6).
4. **"Updates · 3":** the chain with "Edit" (available for 15 minutes) and "Delete" per link.
5. **"Comments · 6":** each row has Hide / Pin as Team answer; toggle "Lock comments"; flagged count 0.

**Right column (380px)**
- **Details:** title, area, pitch fields + note "Changes show an 'edited' mark to players."
- **Demand:** ▲ 13 ▼ 0 · Pass reasons "none" · 7-day backs sparkline · "Standard 8 · Domain 5 · 9 from result screens" · following 13.
- **GitHub:** "#459 merged" + buttons "Link #" / "Create issue" + note "The board never waits on GitHub."
- **End-of-activity question:** "Off" + "Add a yes/no question".
- **Playtest:** disabled with "Available in Testing".
- **Danger:** [Return to review] · [Merge into…] · [Won't do].

**State insets**
1. **Move to Shipped composer**
   - "Shipped line (players read this)" pre-filled "Card text, clock names and lobby wording fit on narrow phones." (120 limit), name check clear.
   - Checkboxes: "Add to this week's Shipped log (Nov 2–8)", "Notify 13 followers", "Ask backers 'Working well?' after 3 days".
   - [Move and post].
2. **Won't do dialog**
   - Canned reasons: "Would hurt fair play" / "The engine can't support it" / "We chose another way" + link / Other.
   - Text (200 characters) with a public preview in Newsreader italic.
3. **Parts editor (Ranked umbrella):** 6 part rows with status selects and vote numerals; "Add part".
4. **End-of-activity question (Ranked queue)**
   - Question "Would you have queued for a ranked match just now?"
   - Yes label "Yes, I'd queue", No label "Not for me".
   - "Ask after: Duel result (1v1) · Series end".
   - "Yes counts as Back, No as Pass."
5. **Playtest (Theme drafts):** "Playtesters 4" (avatars) · "Requests 2" [Add] [Dismiss].

---

## 8. Canvas layout

| Row title | Artboards, left to right |
|---|---|
| **Player board** | Main · Roadmap · IdeaRanked · IdeaBuilding · Shipped |
| **Posting and moments** | Submit · DuelPrompt · DraftPrompt · ShippedNotice |
| **Phone** | PhoneBoard · PhoneDuelPrompt |
| **Owner console** | AdminQueue · AdminRoadmap · AdminIdea |

State insets sit to the right of each frame. Leave a 160px gap between rows and put each row title in Oxanium 600 21px `--ink-3` above its row.

---

## 9. Said vs assumed, and open questions

**What the owner said**
- A new feedback section with a board that collects people's intake.
- The owner approves submissions.
- Start the board with a feature set, including a rank system, plus generated ideas.
- Prompt people for feedback when they finish doing something, to keep the board populated.
- Upvotes and downvotes.
- Show progress: how things work, what's been done, what's being built.
- Players and the team can both vote and give input.
- Control and approve everything from the existing admin panel, including putting ideas into progress directly.
- Think abstractly.

**What this brief assumes**
- **Naming and placement**
  - The name is "Next Turn", in a new Community sidebar group.
  - Votes are labelled Back and Pass, with optional reasons, a played gate and equal weight.
- **Status and progress**
  - Statuses are set by hand. GitHub is optional and never blocking, and automation waits for phase 3.
  - There are no dates or percentages; build steps and updates carry progress, and a Building guard of 3 applies.
  - Ranked is one umbrella of six votable parts, built as ordinary child ideas. All parts are seeded Open.
  - Seed statuses for Theme drafts, Card details, Readable text, Format names and Daily puzzle mirror the current roadmap and switches. They need confirmation (†).
- **Intake**
  - Prompts come vote-first, with caps of 1 a day and 3 a week, a first prompt after the 3rd activity, no prompts to spectators and no win/loss-based suppression.
  - Context shown publicly is limited to mode and format.
- **People and identity**
  - "Team" means the OWNER_USER_IDS allowlist.
  - Author credit is on by default with a toggle; backers stay anonymous.
- **Admin**
  - The admin view is a seventh view called "Ideas", with seven labelled phone tabs.
- **Notices, reach and tone**
  - Notices are in-app only (nav dot, Yours, dashboard strip, follow-up prompt).
  - Testing access is a hand-managed playtester list.
  - The duel result prompt keeps the existing celebration intact and adds nothing above the actions.

**Open questions for the owner**
1. **Who counts as Team?** Only the owner allowlist, or a new "team member" flag so others can post updates and Team answers without full console access? This changes the admin access model and who carries the gold tag.
2. **Should every idea need your approval forever?** Or can players with, say, 2 approved ideas skip the queue? This changes the queue's size and the "face-down" promise in the composer.
3. **Which Ranked parts are actually planned?** Are you comfortable showing the soft-reset numbers (halfway to 1000, an 8-week season) publicly? This decides whether the Ranked page leads with a Planned part and the personal season preview.
4. **Testing access:** a hand-picked playtester list per idea, an "opt in to all playtests" setting in Account, or a switch for everyone? Each needs a different "Try it" flow and admin playtest panel.
5. **Reaching lapsed players:** may the app send an opt-in email ("an idea you backed shipped", at most weekly) through the account email? If yes, add a Notifications block in Account and an email template artboard.
6. **Names in public:** keep author credit on by default, or opt-in only? Should backers ever be able to show their names? This changes the composer toggle, the shipped-line credits and the profile.