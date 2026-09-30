# Obsidian Arena Reference Skin Implementation Plan

> **For agentic workers:** Implement in this session after parent crop/plan approval. Fast worker owns builds/browser/runtime; coordinate through parent. Do not run project-wide lint/test/build mid-flight.

**Goal:** Restyle the existing Obsidian duel room to original `designs/duel-ui/nexus-classic/variation-2-obsidian-arena.webp` (1659×948) without changing Dueling Nexus monster/EMZ geometry, legal-action logic, privacy, prompts engine, WebSocket, or database behavior.

**Architecture:** CSS-module + small markup skin on `packages/web/src/components/duel`. Field zone grid, portrait/landscape frame rules, and attack/defense transforms stay untouched. HUD uses CSS Grid/flex anchors (not viewport pixel coords). LP badges overlay the felt container’s top-left / bottom-left gutters. Card backs and **stone-grain** felt use lightweight crops from Variation-2 only. The central sun/compass is a **static SVG** (not the current enormous rings, not a photo of the whole board). No full-UI backdrop, no generated art. Existing SWR/engine events remain the only state source.

**Tech Stack:** Next.js 16 client components, CSS modules, existing Chakra Petch / Russo One fonts, live `/api/cards/.../image` art.

**Reference:** Variation-2 original only. Do not copy its inaccurate landscape MZ outlines; existing `.zone[data-kind="mz"|"emz"]::before` remains authoritative. Do not use `states/*` or later variation renders.

**game-ui-ux (applied, not expanded):** anchored HUD + `1fr` field expand; `env(safe-area-inset-*)` on header/phases/LP; overflow-x `safe center` on hands; keep existing keyboard focus-visible / card-menu / PromptTray keys. No gamepad neighbors, no new screen-stack, no per-frame polling.

---

### Frozen (do not edit)

- `field.module.css` geometry: `.felt` `grid-template-rows`, `--pile-col` / `--zone-gap`, `.half`/`.emzBand` columns, `.rows` / `.halfLocal .rows`, `.zones`/`.emzRow` `repeat(5,…)`, `.emzRow > :not(:nth-child(2)):not(:nth-child(4))`, `.frame` `aspect-ratio: 59/86`, ST/pile frame height `calc(100cqw * 86 / 59)`, MZ/EMZ `::before` landscape `86/59` at `left:50%; top:46%`, `.cardFace[data-defense=true]` / card-back `rotate(90deg)`.
- `field.tsx` `extraMonster`, `extraMonsterKeys`, `MonsterRow`, `SpellRow`, `PileColumn` order, `DuelField` EMZ slots 2+4, `MZ_COUNT`/`ST_COUNT`.
- `prompts.tsx` legal-key / `activatePromptFromField` logic; `isHiddenCard` / `isFacedown` / `showArt`; `api.ts`, `duel-host.ts`, engine, ws, db.
- Do not hardcode sample cards, counts, or LP. Do not use the screenshot as a functioning UI.

Hand **size** may change. Hand **safe-center horizontal scroll** must stay.

---

### Crops (parent inspect `/tmp/obsidian-arena-crops/` before copy)

Source: `designs/duel-ui/nexus-classic/variation-2-obsidian-arena.webp` original pixels.

| File | Box xyxy | Use |
|------|----------|-----|
| `05-felt-grain.png` | 22,745,250,900 | Inspector inner navy below description, inside frame (no field diagonals). Public: `felt-grain.webp` as 2×2 mirrored-edge tile (456×310). |
| `03-card-back-main.png` | 653,61,725,151 | Full first opponent-hand card including thin gold edge. Public: `card-back-main.webp`. |
| `04-card-back-extra.png` | 1272,149,1334,234 | Full extra pile card spiral; left stacked-pile UI trimmed, thin edge kept. Public: `card-back-extra.webp`. |
| `01-felt-sun.png` | 741,413,910,497 | SVG reference only. |

Reject: empty-MZ label region; 30×52 off-center pile interior; 18×58 grain sliver.

Desktop rails: `clamp(205px, 16vw, 250px)` / `1fr` / `clamp(175px, 16vw, 250px)` (250 at 1568; not fixed 250 at 901px).
LP gutter `--lp-gutter: 7rem` (~112px); clip name, never LP.

---

### Task 1: Assets

- Create: `packages/web/public/duel/felt-grain.webp`
- Create: `packages/web/public/duel/card-back-main.webp`
- Create: `packages/web/public/duel/card-back-extra.webp`

- [ ] Convert approved 05/03/04 PNGs to webp. Do not copy `01-felt-sun` into public.

---

### Task 2: Room chrome (header, rails, phases, prompt dock)

**Files:**
- Modify: `packages/web/src/components/duel/room.module.css`
- Modify: `packages/web/src/components/duel/room.tsx`
- Modify: `packages/web/src/components/layout/app-shell.tsx` (duel route padding only if 250px rails need full bleed)

Desktop ~1568×896:

- Header **43px**. Compact identity + Turn/phase. Real Sound on/off and Motion label from `useDuelPreferences`. Gear sets `pane` to `"options"` (existing inspector/sheet). **Do not** render fake `Chain: Auto`.
- Domain grid: `250px minmax(0,1fr) 250px` (masters currently cap at 210px). Non-domain: `250px minmax(0,1fr)`. Extra width goes to the field. Inset `env(safe-area-inset-*)`.
- Navy-black shell (`#0a1018` range), thin antique-gold header rule. Purple selected tabs. Local master rail purple border lives on the masters column, not the field grid.
- Remove the horizontal `.lifeBar` strip (LP moves in Task 3).
- `.phases`: compact **centered** DP SP M1 BP M2 EP; transparent strip, not full-width boxed panels. Keep existing `PHASES` actions/`aria-current`. Purple current step.
- Collapse idle `.promptDock` (waiting-only): no thick empty band. Keep `aria-live` waiting copy visually quiet. Meaningful prompts, errors, chain, and accessibility stay.

```css
.layout {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  height: calc(100dvh - 43px);
  padding: 0.4rem;
  padding-left: max(0.4rem, env(safe-area-inset-left));
  padding-right: max(0.4rem, env(safe-area-inset-right));
}
.shell[data-domain="true"] .layout {
  grid-template-columns: 250px minmax(0, 1fr) 250px;
}
```

Keep existing 900px stacked layout; hide inspector, show mobile tabs/sheet.

---

### Task 3: Field skin, LP gutters, hand size, card backs

**Files:**
- Modify: `packages/web/src/components/duel/field.module.css` (colors, overlays, hands, backs — **not** frozen selectors)
- Modify: `packages/web/src/components/duel/field.tsx` (`FeltEtch` motif, LP overlay siblings, `DeckMasterRail` controls)
- Modify: `packages/web/src/components/duel/card-face.tsx` only if back images need a class; do not change `showArt` / defense

- [ ] `.felt` fill `#0c121c` (or sampled slate) + **repeat** `url(/duel/felt-grain.webp)` so stone grain stays visible. **Do not** bury it under the current opaque radial (`--mat-lift` / `#182737` wash) or a heavy vignette. Optional vignette max ~12% opacity. Thin antique-gold inset chamfer on `.felt` via `border`/`box-shadow`, **not** by changing zone `::before` geometry.
- [ ] Replace `FeltEtch` with a **static** SVG `viewBox="0 0 1000 1000"` (hardcoded `path`/`circle`, **no** `Array.from` / `Math.cos` per render). Small carved sun/compass in the EMZ gap, muted stone gray/gold, not a luminous magic circle:
  - center circle **r=30** at (500,500)
  - **16** tapered triangular rays, tips at **r=60** (static `d` below)
  - two outer rings **r=73** and **r=83**
  - thin **double** architectural diagonals toward the four corners, low contrast
  - `pointer-events: none`; `.etch` stays `position:absolute; inset:0`

```tsx
function FeltEtch() {
  return (
    <svg className={styles.etch} viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="rgb(168 162 148 / 0.16)" strokeWidth="1">
        <path d="M70 70L930 930M78 62L938 922M930 70L70 930M922 62L62 922" />
      </g>
      <g fill="none" stroke="rgb(186 168 120 / 0.28)" strokeWidth="1">
        <circle cx="500" cy="500" r="73" />
        <circle cx="500" cy="500" r="83" />
      </g>
      <circle cx="500" cy="500" r="30" fill="none" stroke="rgb(176 168 150 / 0.38)" strokeWidth="1.15" />
      <path
        fill="rgb(170 162 140 / 0.22)"
        d="M529.9 497.3L560.0 500.0L529.9 502.7ZM528.6 508.9L555.4 523.0L526.6 513.9ZM523.0 519.2L542.4 542.4L519.2 523.0ZM513.9 526.6L523.0 555.4L508.9 528.6ZM502.7 529.9L500.0 560.0L497.3 529.9ZM491.1 528.6L477.0 555.4L486.1 526.6ZM480.8 523.0L457.6 542.4L477.0 519.2ZM473.4 513.9L444.6 523.0L471.4 508.9ZM470.1 502.7L440.0 500.0L470.1 497.3ZM471.4 491.1L444.6 477.0L473.4 486.1ZM477.0 480.8L457.6 457.6L480.8 477.0ZM486.1 473.4L477.0 444.6L491.1 471.4ZM497.3 470.1L500.0 440.0L502.7 470.1ZM508.9 471.4L523.0 444.6L513.9 473.4ZM519.2 477.0L542.4 457.6L523.0 480.8ZM526.6 486.1L555.4 477.0L528.6 491.1Z"
      />
    </svg>
  );
}
```

- [ ] Hands (allowed): opponent max **~4.1–4.4rem**, local max **~6.8–7.2rem**. Keep `justify-content: safe center` + `overflow-x: auto`. Increase inline padding so LP badges never cover first/last card.
- [ ] LP overlay **inside** `.felt` (not a new grid row): opponent top-left, you bottom-left. `position: absolute` vs `.felt`; `pointer-events: none`. Live `formatLp(seat.lp)` + existing player names passed from `room.tsx`. No hardcoded 8000.
- [ ] `.cardBack` / `.cardBackExtra`: `background-image` the approved spirals; remove generic concentric `::before`/`::after` blobs. Keep box size and defense rotation.

```css
.handCard { width: clamp(2.6rem, 8.6cqw, 4.25rem); }
.handLocal { padding-inline: 4.75rem; }
.handLocal .handCard { width: clamp(3.5rem, 13cqw, 7rem); }
.lpOpp { position: absolute; top: 0.35rem; left: 0.4rem; z-index: 2; pointer-events: none; }
.lpYou { position: absolute; bottom: 0.35rem; left: 0.4rem; z-index: 2; pointer-events: none; }
```

---

### Task 4: Inspector, Master docks, menus, prompts (chrome only)

**Files:**
- Modify: `inspector.module.css`, `inspector.tsx` (layout chrome only)
- Modify: `field.tsx` `MasterDock` / `DeckMasterRail`
- Modify: `room.module.css` `.cardMenu` / `.cardTooltip`
- Modify: `prompts.module.css` (tokens only)

- [ ] Left inspector: full-art (`cardArtUrl(..., "full")` already), navy-black + gold inset, ~250px column.
- [ ] Two stacked Master docks. Your Master: purple border. Add **Inspect** (`onInspect` existing). Add engine-offered action **label(s)** from `optionsForCard(prompt, card, keys)` when `canAct`; click submits `{ choice: option.id }` via existing `onSubmitAnswer` / same path as the card menu. Never render unconditional “Normal Summon”.
- [ ] Skin `.cardMenu` / prompts to the same gold/purple/navy. Do not change menu positioning, Escape, or prompt kinds.

---

### Task 5: Verify (fast worker)

No new visual/CSS unit tests. Do not run repo-wide `npm test` / typecheck / build from this worker.

- [ ] Existing `packages/web/tests/components/duel-event-queue.test.ts` still valid (untouched).
- [ ] Parent/fast worker captures desktop ~1568×896 Domain table: rails 250/field/250, header ~43px, hand sizes, LP gutters vs 1- and 7-card hands, M1 purple, idle dock collapsed, Inspect + legal Master label only when offered, facedown brown/purple backs, **visible stone grain** (no opaque radial wash), **small** EMZ-gap sun (r≈30/60/73/83 on 1000 viewBox — not four huge rings), no screenshot backdrop, MZ/EMZ geometry unchanged.
- [ ] Narrow ~390px: stacked field, inspector sheet, hands still scroll, LP not covering cards.

---

**Out of scope:** gamepad focus graph, new HUD state store, image generation, alternate layouts, engine/WS/DB, copying Variation-2’s landscape MZ outlines.
