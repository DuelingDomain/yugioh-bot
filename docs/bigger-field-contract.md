# Bigger field: shared contract

Owner spec 2026-10-16: the duel field and its cards are as large as possible in every format (1v1 normal, 1v1 3D, Tag, FFA3, FFA4). The field stays 2D (no tilt). Nothing covers the field in normal play. Side content moves into drawers that are closed by default.

This file is the contract for the shared pieces in `packages/web/src/components/duel/edge-drawer/`. Each format builds on these pieces and does not make its own drawer or fit code. The study with the measurements is in the session scratchpad (`bigfield/report.md`).

Import everything from `@/components/duel/edge-drawer`.

## Rules every format follows

1. Nothing sits on the field area in normal play: no panel, HUD, log, chat, Deck Master panel, peek panel or nameplate. LP, phase, timers and turn info go in the slim top and bottom bars.
2. Side content goes in an `EdgeDrawer`. It is closed by default. It opens when the player acts (tab click or hover, keyboard shortcut, click on a log entry, inspect on a card). When it is open it may cover the field. When the player leaves or closes it, it slides back.
3. A closed drawer shows only its edge tab. The tab glows (`attention`) when there is something new or important. The glow is subtle, has one beat when it turns on, never loops, and has no beat under `prefers-reduced-motion`.
4. The field is the largest size that fits the room left by the bars. No width cap. Height is the limit in most formats.
5. Never auto zoom IN. An automatic step may shrink the field or return it to the fit. It must not go above the fit (`capAutoZoom`). A player can still zoom in on purpose.
6. No change to game rules. Keep: field cracks, FFA4 2x2 grid with zoom on my field, Tag Rooftop, facing pairs, Genesys boards (no EMZ or PZ), replay and spectate, 3D mode, glow on usable cards, chain and target highlights, tilted seats, mobile.

## 1. `EdgeDrawer`

```tsx
<EdgeDrawer
  side="right"            // "left" | "right" | "bottom"
  label="Log"             // tab text and the accessible name of the panel
  icon={<ScrollText />}   // optional, 14px
  attention={hasNew}      // glow on the tab
  count={newCount}        // badge: 1..99, then "99+"; 0 or undefined shows nothing
  tone="violet"           // "violet" (default) | "gold" (the player can act)
  shortcut="l"            // optional single key
  {...drawers.bind("log")} // open + onOpenChange from useExclusiveDrawers, or pass your own
  size="min(360px, 88vw)" // panel width (left/right) or height (bottom)
  tabOffset="40%"         // where the tab sits along the edge
>
  ...content...
</EdgeDrawer>
```

Props:

| Prop | Default | Meaning |
|---|---|---|
| `side` | required | Edge the drawer is on. |
| `label` | required | Tab text. Also `aria-label` of the panel. |
| `icon`, `attention`, `count`, `tone` | none, false, none, `violet` | Tab look. See "Edge tab". |
| `open`, `defaultOpen`, `onOpenChange(open, via)` | uncontrolled, closed | Controlled or not. `via` is `"hover" \| "click" \| "key" \| "api"`. |
| `shortcut` | none | One key that toggles the drawer. Ignored while typing in an input, when Ctrl, Alt or Meta is down, and on key repeat. |
| `hoverOpen`, `hoverDelayMs`, `hoverCloseMs` | true, 140, 280 | A mouse or pen on the tab opens it after the delay. It closes when the pointer leaves the tab and the panel. Touch never hover-opens. |
| `closeOnOutside` | true | A pointer press outside closes it. The press still goes to what it hit (no scrim). |
| `closeOnEscape` | true | Escape closes it. |
| `size` | `min(360px, 88vw)` / `min(320px, 58dvh)` | Sets `--bf-drawer-size`. |
| `tabOffset` | `50%` | Sets `--bf-tab-offset`. Use it to stack several tabs on one edge. |
| `fixed` | false | `position: fixed` (viewport) instead of absolute (nearest positioned ancestor). |
| `className`, `panelClassName` | none | Extra classes on the root and the panel. |

Behaviour:

- Closed by default. The panel is `inert`, `aria-hidden` and `visibility: hidden`, so it is out of the tab order. The root has `pointer-events: none`, so a closed drawer never blocks the field. The tab and the open panel take pointer events.
- Opening by hover does not move focus and does not trap it. A click on the tab while it is hover-opened pins it. Opening by click, Enter or Space, the shortcut, or the parent (`open` becomes true) moves focus into the panel (first focusable, else the panel) and traps Tab inside it.
- Closing from the tab, Escape, or the shortcut gives focus back to the tab when focus was inside the panel. Closing by an outside press does not move focus.
- Slide: the panel and its tab move together on a 220 ms transform, so only the tab is on screen when it is closed. Under `prefers-reduced-motion` the panel fades (140 ms) and does not travel; the tab glow stays without the beat.
- The root is `position: absolute`. Put the drawers inside the duel stage element (the one that fills the viewport and is `position: relative`). Do not put them inside a transformed element (the 3D plane, the Tag camera, the FFA3 stage). A transform makes `fixed` and `absolute` children follow that transform.
- Escape: the drawer calls `preventDefault()` on the Escape it handles. Other Escape handlers on the duel screen must step aside: the Yes/No pre-check maps Escape to "no" (`prompt-center.tsx` `precheckKeyAction`), and the camera maps Escape to leaving focus mode (`table/camera-model.ts`). Guard them with `event.defaultPrevented` or `anyEdgeDrawerOpen()`. Do this in the first format that mounts a drawer.
- Shortcut keys already used on the duel screen: `y`, `n`, `f`, `o`, `p`, `0`, `[`, `]`, Escape, Enter. Suggested free keys: `l` log, `m` Deck Master, `c` chat, `i` inspect. Check again before you add one.

### `useExclusiveDrawers<K>()`

Keeps one drawer open per room. `bind(id)` returns `{ open, onOpenChange }` to spread on an `EdgeDrawer`. `closeAll()` closes all (call it when a prompt needs the whole field, for example a target pick). `openId` tells which one is open.

```tsx
const drawers = useExclusiveDrawers<"log" | "master" | "inspect">();
<EdgeDrawer side="left" label="Master" {...drawers.bind("master")}>...</EdgeDrawer>
// open the inspect drawer from a card click:
drawers.bind("inspect").onOpenChange(true);
```

### `anyEdgeDrawerOpen()`

True while any drawer is open. Cheap DOM query. Use it in Escape handlers.

## 2. `EdgeTab`

`EdgeDrawer` renders one. Use `EdgeTab` alone only for a custom drawer.

| Prop | Meaning |
|---|---|
| `side`, `label`, `icon` | Edge, text, 14px icon. Text is vertical on left and right tabs. |
| `attention` | Glow. One 1.4 s beat when it turns true, then a steady soft glow. No loop. |
| `count` | Badge. Also read by screen readers as "N new". With `attention` and no count the reader says "new". |
| `tone` | `violet` for news (log, chat). `gold` for "you can act" (Deck Master can act, inspect has a ruling). Keep both rare. |
| `open`, `controlsId` | `aria-expanded` and `aria-controls`. |

It is a real `<button>`: Enter and Space work. The tab is 26 px thick (36 px on a coarse pointer). It sits flush on the screen edge, so it takes a few px at the edge but does not overlap the field when the field is centered with at least the pad (4 px) on its sides. In a height-limited format the side margin is wide, so the tabs sit in the margin.

When to set `attention`:

| Drawer | Attention when |
|---|---|
| Log | A new entry came in while it was closed. Count = entries since it was last open. Clear on open. |
| Chat | A new message came in while it was closed. |
| Deck Master | The Deck Master can act now (usable effect or summon), or it has a new state. Tone `gold`. |
| Inspect / peek | Usually no tab glow: it opens from a card action. A tab is only a fallback. |
| Responses | A prompt is waiting and the panel is not the prompt itself. Prefer to keep prompts in the corner stack. |

## 3. Fit-to-viewport helpers

### CSS frame (`field-frame.module.css`, `fieldFrame`, `fieldFrameVars`)

Use this for formats that fit in CSS (1v1 normal, 1v1 3D, FFA4 cells, the plain parts of any format).

```tsx
import { fieldFrame, fieldFrameVars } from "@/components/duel/edge-drawer";

<div className={fieldFrame.frame} style={fieldFrameVars({ cols: 11.3, rows: 6.4 })}>
  <header className={fieldFrame.topBar}>LP, names, phase, timer</header>
  <div className={fieldFrame.area}>
    <div className={fieldFrame.fit}>{/* the field; one zone is var(--bf-z) wide */}</div>
    {/* drawers go here: they are absolute inside .area */}
  </div>
  <footer className={fieldFrame.bottomBar}>hand count, buttons</footer>
</div>
```

- `cols` and `rows` are the natural size of the field in zone units, with the gaps. The format sets them from its own layout. (Example: one row of 7 zones with 0.2 gaps is about 8.2 columns.)
- `.fit` is `cols * --bf-z` wide and `rows * --bf-z` high. `--bf-z = max(--bf-z-min, min((area width - 2 pad) / cols, (area height - 2 pad) / rows))`, computed with container units (`cqw`, `cqh`) of `.area`. No clamp ceiling and no `max-width`.
- Tokens on `.frame`: `--bf-bar-top` (28 px), `--bf-bar-bottom` (32 px), `--bf-pad` (4 px), `--bf-z-min` (24 px). `data-bars="top" | "bottom" | "none"` drops a bar row.
- `.frame` is `height: 100dvh`. Override the height if the frame sits in a smaller host.
- Children of `.fit` size their cards from `--bf-z` (a card is one zone wide, a Defense card one zone high). Existing formats use their own `--z` or `--duel-unit`: map it with `--z: var(--bf-z)`.
- The old HUD variables (`--hud-top`, `--hud-bottom`, `--hud-left` in `room.module.css`, `table-shell.module.css`, `tag-shell.module.css`) feed field cracks and the turn glow. When a format moves to the frame it must set those variables from the new bar heights and `0` for left, so cracks and glow follow.

### JS helpers (`fit-field.ts`)

Use these for formats that fit in JS (Tag camera `roofFit`, FFA3 `stageFit`, FFA4 `grid-layout.ts`).

| Function | Use |
|---|---|
| `availableRoom({ viewportWidth, viewportHeight, topBar, bottomBar, leftInset, rightInset, pad })` | The room left after the bars. Keep `leftInset` and `rightInset` at 0: drawers float. |
| `fitFieldScale({ roomWidth, roomHeight, contentWidth, contentHeight, minScale?, maxScale? })` | Scale of the largest box that fits. 0 when the room or content is empty. `maxScale` is off by default. |
| `fitFieldBox(input)` | Same plus the scaled size and the centered `left` and `top`. |
| `fitLimit(input)` | `"width"` or `"height"`: the direction that decides. Use it in tests and logs. |
| `capAutoZoom(requested, fit)` | `min(requested, fit)`. Wrap every automatic zoom or scale step with it. |
| `useElementSize(ref)` | Content box of an element, kept current with `ResizeObserver`. Starts at 0 x 0 (server, jsdom): treat 0 as "not measured". |

## 4. How each format uses it

Numbers are from the study at 1920x1080 (field zones box; card width now). The goal is a larger card in every row. Apply the frame and bars on wide screens only. Keep the narrow layouts (media queries at 900, 1150, 1320 and 641 px) as they are, with the log and Deck Master drawers on the bottom edge there.

### 1v1 normal (flat 2D, no tilt)

Now: field about 52% x 89% of the viewport, card 100 px. Height limited. The board is about 1000 px wide and centered. The left 353 px is reserved and the right is the corner stack.

- Use `fieldFrame`. Put the phase bar, LP and names in the slim top bar, the end-turn and timer in the bottom bar. Take them out of the field rows.
- Spend the spare width: move the pile columns (Deck, Extra, GY, Banished, Field) outward and make the zone grid wider, so every zone is larger. Raise `cols` to match. Cut the gaps between zone rows to shrink `rows`.
- The hand sits at or overlaps the bottom edge.
- Left drawer: Deck Master (tone gold). Right drawer: Log. The peek becomes an inspect drawer that opens from a card click or inspect action. The responses panel, if it is a side panel, becomes a drawer. Prompts stay in the corner stack.
- Report card px before and after at 1920x1080, 2560x1440 and 1366x768.

### 1v1 3D / Solid (still 3D, own tilt)

- Replace the 420 px Card/Log panel (`--insp-w`) and the 280 px Masters dock (`--dock-w`) with a left and a right drawer. Set both widths to 0 in `solid-room.module.css`.
- Keep `--hand-h` at its current size (the study mockup shrank the hand by mistake).
- Do not put a `transform` on the root. Mount the drawers outside the tilted plane, in the stage. `BattleFx` needs its fixed viewport container.

### Tag 2v2 (Rooftop)

- Height limited, so the left column alone gives nothing. Cut the top and bottom padding (`--hud-top` 52 px, `--hud-bottom` about 88 px in `tag-shell.module.css`) by moving the HUD into the slim bars.
- Free the 353 px left column. Peek, Deck Master plate and dock icons become drawers.
- Feed the fit through `availableRoom` into `roofFit` (`tag/roof-camera.ts`). Camera presets and the nameplate-click zoom stay. Wrap automatic changes in `capAutoZoom`.

### FFA3

- Edge to edge already. Trim top and bottom padding with the slim bars, and make the Deck Master plate and log drawers. The home-priority layout is a later step.
- `stageFit` (`table/geometry.ts:887`) takes its room from `availableRoom`.

### FFA4 (2x2 grid)

- Width limited at 1080p because of the 353 px left reservation. Free it (`--hud-left` in `table-shell.module.css`, `--pv-col-w` in `grid-hud.module.css`): the peek column becomes the inspect drawer.
- `HUD_CORNER` (180x214) shrinks as the HUD moves into the bars. Keep the zoom on my field and the FLIP animation. Facing seats 0+1 and 2+3 keep their shared EMZ and columns.
- Expected gain in the study: +16 to +23% card width.

### Replays, spectate, Genesys

- They use the same shells, so they get the same frame and drawers. Genesys boards have no EMZ or PZ: compute `cols` and `rows` from the real zone list, not from a fixed number.

## 5. Test and check list for each format

- Unit tests for the new layout numbers (columns, rows, hud variables) and for any moved logic.
- Playwright at 1920x1080, 2560x1440, 1366x768 and one mobile width, on `/dev/table-preview/*` and `/dev/solid-preview` of your own dev server. Record the field share of the viewport and the card px, before and after. Check that no HUD, panel or nameplate overlaps the field area, that every drawer tab shows and glows, and that a drawer opens, traps focus, and closes with Escape.
- Check with `prefers-reduced-motion: reduce`.
- Check field cracks, turn glow, usable-card glow, chain and target highlights.
