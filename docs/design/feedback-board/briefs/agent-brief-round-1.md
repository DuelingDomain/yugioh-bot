# Workshop brief: one approach chapter for the feedback board

You write ONE approach chapter for a single HTML page that compares three approaches to a feedback section for Dueling Domain, a web app where an invitation-only alpha (41 members) plays online card duels, cube drafts and tournaments, builds decks and cubes, and watches replays. Three designers work in parallel, one per approach. The owner reads this page to choose a direction, so every approach must answer the same request with the same seed content, and differ only in concept.

## Paths

- WS = docs/design/feedback-board (this folder; the workshop originally ran in a scratch folder with the same layout)
- Page shell (read it first; it defines every shared class and token): WS/shell.html
- Your file (the ONLY file you write): WS/approach-<x>.html
- Check (must end with 0 errors): node WS/tools/check-fragment.mjs <x>
- Assemble a full page to look over the markup in context (optional): node WS/tools/assemble.mjs WS/preview-<x>.html (write only your own preview-<x>.html)
- Product context and seed content: WS/research/product-brief.md. Read section 1 (concept), 5 (seed content: the rank system umbrella NT-101 with its six parts, team seeds, player samples, dev updates, the real Shipped log) and 6 (visual system: player tokens, fonts, admin console look). Approach A also reads sections 2-4 and 7.
- The real product (read-only, for its visual parts when you need them): packages/web/src

Never write anywhere except your own approach-<x>.html and preview-<x>.html.

## The request every approach answers (codes are used across the page)

- R1 Intake board: a place that collects ideas from players.
- R2 Owner approval: the owner approves an idea before everyone sees it.
- R3 Seeded features: starts with the rank system plus team ideas.
- R4 Prompts after activities: asks at the end of duels, drafts and tournaments so the board stays full.
- R5 Upvote and downvote: both directions count.
- R6 Visible progress: what's done, what's in development, and how shipped things are working.
- R7 Players and team both post and vote.
- R8 Controlled from the existing admin console: approve, set progress, move ideas into development.

## Chapter structure (follow this order and these shell classes)

```html
<section class="ws-approach ap-x" id="approach-x" aria-labelledby="apx-title">
<!--NAME:Short approach name-->
<style>
  /* every selector starts with .ap-x ; keyframes are named apx-... */
</style>
<header class="ws-ap-head">
  <p class="ws-eyebrow">Approach X</p>
  <h2 class="ws-h2" id="apx-title">Name</h2>
  <p class="ws-thesis">One sentence: what this approach believes a feedback board is.</p>
  <p class="ws-lede">Two or three sentences: the model and the borrowed shape, in plain words.</p>
</header>

<div class="ws-block">
  <h3 class="ws-h3">The model</h3>
  <!-- How an idea moves, who acts when, and the 3-5 rules that make it work. A small diagram drawn in HTML/CSS (or inline SVG) is welcome here. -->
</div>

<div class="ws-block">
  <h3 class="ws-h3">Screens</h3>
  <!-- Exactly these five, each a <figure class="ws-fig"> with a <figcaption class="ws-caption"> (bold lead-in naming the screen, then one or two sentences on what to notice):
       S1 Player board (desktop)                           <div class="ws-screen-scroll"><div class="ws-screen">...</div></div>
       S2 Progress: the rank system idea page or another idea in development, showing done / building / how it's working (desktop, same wrapper)
       S3 End-of-activity prompt: on the duel result screen (desktop, same wrapper)
       S4 Owner control in the admin console: approve and move progress (desktop)   <div class="ws-screen-scroll"><div class="ws-screen ws-screen--admin">...</div></div>
       S5 Phone: the board or the prompt at 390 wide        <div class="ws-phone-row"><div class="ws-phone"><div class="ws-phone-inner">...</div></div></div>
  -->
</div>

<div class="ws-block">
  <h3 class="ws-h3">How it covers the request</h3>
  <div class="ws-req-scroll"><table class="ws-req"><tbody>
    <tr><th scope="row">R1</th><td>Intake board</td><td>One or two sentences.</td></tr>
    ... R2 to R8, same labels as above ...
  </tbody></table></div>
</div>

<div class="ws-block">
  <h3 class="ws-h3">Trade-offs</h3>
  <div class="ws-trade">
    <div class="ws-card ws-pro"><h4>Strengths</h4><ul>3 items</ul></div>
    <div class="ws-card ws-con"><h4>Risks</h4><ul>3 items</ul></div>
    <div class="ws-card ws-cost"><h4>Build size</h4><p class="ws-size">S, M or L</p><p class="ws-p">What drives the size, relative to the app as it is.</p></div>
  </div>
</div>

<div class="ws-block">
  <h3 class="ws-h3">Assumes and asks</h3>
  <div class="ws-cols">
    <div class="ws-card"><h4 class="ws-h4">What it assumes</h4><ul class="ws-list">...</ul></div>
    <div class="ws-card"><h4 class="ws-h4">Questions it raises</h4><ul class="ws-list">at most 4</ul></div>
  </div>
</div>
<script>
(() => { const root = document.getElementById("approach-x"); /* query only inside root */ })();
</script>
</section>
```

## Rules

- **Scoping.** Every CSS selector starts with `.ap-x` (the check enforces it). Every `id` starts with `apx-`. No `:root`, `html`, `body`, `@import`, `@font-face`, `<link>` or external scripts; the shell already loads the fonts (Oxanium, Sofia Sans Semi Condensed, Sofia Sans Extra Condensed, Newsreader, Schibsted Grotesk, Martian Mono). One `<style>` and at most one `<script>` (an IIFE that starts from the section root). No inline `on*` attributes, no globals, no storage, no network, no alert/confirm/prompt.
- **Colors.** Page prose uses the shell's chrome tokens (`--fg`, `--muted`, `--line`, `--surface`, `--accent`, `--gold`, ...) so it follows the viewer's light or dark theme. Inside `.ws-screen` and `.ws-phone` use only the fixed mock tokens: `--m-*` for player screens and `--a-*` inside `.ws-screen--admin`. Never mix player and admin tokens in one screen. Text contrast at least 4.5:1 on its background, small grey text included (`--m-ink-3` is the smallest grey for text on player panels; `--m-ink-4` is graphics only; `--a-t3` is the smallest admin grey).
- **Width.** Desktop screens are designed for 960-1180px inside `.ws-screen` (it has min-width 960 and scrolls sideways on small screens; that's intended). The phone is 390 wide. The page around them must hold at 400px wide with no sideways scroll; give flex/grid children that hold text `min-width: 0`.
- **Real controls.** `<button type="button">` and `<a href>`, labelled inputs, icon-only buttons get `aria-label`. Inline SVG icons (Lucide-style strokes, `aria-hidden="true"`). No emoji, no images (draw any card as a neat blank block in the 59:86 card ratio with a thin gold line, never an imitation of the card game's real card frame).
- **Live where it shows the idea.** Make the up/down votes toggle (count and pressed state change) and one signature interaction that shows your concept. Keep everything visible at rest: no section starts hidden or at opacity 0. Respect `prefers-reduced-motion`.
- **Same seed content.** Use brief.md section 5: the rank system (NT-101) with its six parts, the team seeds, the player samples, the dev updates and the real shipped lines. Use the same invented cast: kaito (Team), lumen, vexmoth, kestrel9, tidebreaker, pellucid, mossgiant, quietstorm, nyx_ra, ashfall. Keep alpha-scale numbers (votes in single or low double digits). Mock "today" is Fri Oct 30, 2026.
- **Never** write the card game's trademarked name or its publisher; say "the game", "cards", "duels". No real people.
- **Copy.** Plain words from the player's side of the screen, active voice, short sentences. No em-dash asides, no "not X, but Y" framing, no stock phrases. Controls say what they do.
- **Abstract thinking.** Push the concept: find the one structural idea that makes your approach distinct, and let it shape the information architecture, not just the skin. Then keep it usable: the metaphor lives in structure and glyphs, every label stays plain English.
- Size: aim under 120 KB for your file.

## Done means

1. WS/approach-<x>.html is written and the check reports 0 errors (fix real warnings too).
2. Your final answer, as plain text, in this shape (the orchestrator builds the comparison table from it):
   - NAME:
   - THESIS (max 20 words):
   - R1 ... R8: one line each
   - STRENGTHS: 3 bullets
   - RISKS: 3 bullets
   - BUILD SIZE: S/M/L + one line why
   - DIFFERENT FROM THE OTHER TWO: one line
   - QUESTIONS FOR THE OWNER: at most 4
   - DEVIATIONS / INVENTED: anything you made up where brief.md was silent
Do not open a browser; the orchestrator runs the visual check after assembly.
