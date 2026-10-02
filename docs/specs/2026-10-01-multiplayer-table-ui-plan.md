# Multiplayer table UI plan (3-way, 4-way, 2v2 tag)

Owner: lead architect. Readers: the agents "scaffold", "3w-1", "3w-2", "3w-3", "4w", "tag". Status: plan, 2026-10-01.
Branch `n-player-ui-implementation`, worktree `/home/sulman633/orca/workspaces/yugioh-bot/n-player-ui` only.

Sources (read only, git-ignored, served at http://localhost:4010/three-way/):
`/home/sulman633/repos/yugioh-bot/.fx-demo/three-way/` → `3way-final.html`, `4ffa-b-duel-disk.html`, `2v2-a-rooftop.html`,
`BRIEF.md`, `BRIEF-MODES.md`, `shots/*.png`. The prototypes are the visual truth. This plan is the code truth.

## 0. Hard rules (every agent)

1. 1v1 does not change. `DuelField`, `room.tsx` and the 1v1 render output stay byte-for-byte the same in behaviour.
   Any change to a shared file adds an optional prop whose default is today's behaviour.
2. Build against fixtures that use the real types (`DuelRoom`, `DuelEngineView`, `DuelPrompt` from
   `@yugidraft/shared/duels`). No new engine fields. The engine is connected later by the user.
3. Keep the FX DOM hooks on every seat: `data-zones="<controller>:<location>:<sequence>"`, `data-lp-seat`,
   `data-hand-seat`, `data-card-art`. Exactly one `data-lp-seat="<n>"` element per seat in the DOM (the holo LP
   panel owns it, so the seat field hides its own Tally). Rival fields keep `data-side="opp"` and add
   `data-seat-angle="<deg>"` (effective angle) for the later FX port.
4. The camera locks (eases to the plaza/home pose) while FX play. User camera input waits until the lock ends.
5. Usable cards: slim soft glow plus a small top icon chip (reuse `UsableGlow` / `field.module.css .glow`).
   Never dashed cut-out outlines. Never dim cards. Partner cards (tag) get the legal ring but no USE glow.
6. Seat colours are relative to the viewer: you Violet `#9b7eff` (ink `#c6b6ff`), Ice `#5cb8f5` (`#a9dcfb`), Verdant
   `#8fd36b` (`#c4ecad`), Rose `#f08cc4` (`#fbc8e4`). Gold = chain, red = damage, ember = battle. Never seat colours.
7. Reuse, do not copy. Import existing components. If one needs a change, add an optional prop (3w-* only).
8. Disk is tight. No repo copies, no `next build`, no `npm ci`. Screenshots and Playwright output go to your
   scratchpad, never into the repo. Delete them when done. Delete `packages/web/.next` only if you made a build.
9. Commits: stage only your own files by path (`git add <paths>`). If `.git/index.lock` exists, wait and retry.
   Never push, never open PRs, never merge. End messages with your model's `Co-Authored-By` line.

## 1. Architecture

```
packages/web/src/components/duel/
  table/                      shared N-seat framework (3w-* own it; scaffold makes types + fixtures dir)
    types.ts                  the contract (section 2). tag imports this.
    geometry.ts               pure: layout per format + seat poses per camera state
    camera-model.ts           pure: camera reducer, key map, FX lock rules
    targets.ts                pure: attack/target choices grouped by seat, default seat, line ends
    seat-state.ts             pure: per-seat status (turn, choosing, leaving, eliminated) + team loss
    table-stage.tsx           the board (live seam): plaza + seat fields + holo LP + ring + hands + line + bar
    plaza.tsx                 backdrop (floor disc, rim, seat pads, fly-in 3D scene container)
    holo-lp.tsx               holo LP panel; follows the projected field box; dashed tether; data-lp-seat
    rival-field.tsx           wraps SeatField with tilt/scale/upright and dock mode
    rival-hand.tsx            card backs fan; data-hand-seat
    turn-ring.tsx             ring around the table; turn order; current seat; next seat
    attack-line.tsx           SVG line from attacker to target card or to holo LP
    opponent-bar.tsx          "Choose opponent" / target seat chips (uses SeatPick)
    camera-controls.tsx       keys + buttons + "Camera locked · FX" chip + Keep pin + Auto
    use-camera.ts             hook: useReducer(cameraReducer) + key listener + FX lock timer
    table-shell.tsx           preview harness shell only (header, inspector, prompt dock, station track)
    *.module.css
    fixtures/                 scaffold owns common.ts, use-fixture-controller.ts, preview-harness.tsx
      common.ts  use-fixture-controller.ts  preview-harness.tsx  ffa3.ts (3w-1)  ffa4.ts (4w)
  tag/                        2v2 Rooftop stage (tag owns it all)
    tag-stage.tsx team-strip.tsx helipad-hub.tsx team-lp-plate.tsx partner-hand.tsx roof-map.tsx
    roof-camera.ts (pure) fixtures.ts tag-stage.module.css
packages/web/app/dev/table-preview/
  page.tsx (index)  ffa3/{page,preview}.tsx  ffa4/{page,preview}.tsx  tag/{page,preview}.tsx
```

Layering. `TableStage` replaces `MultiSeatStage` later (one line in `room.tsx`, not in this phase). It renders
inside the `.board` box, like `MultiSeatStage` does now, and takes FX and `PromptCenter` as slot children, so
the room keeps its shell (header, inspector, history, station track, masters rail, menus, result).
`TableShell` copies no logic: it only lays out the same exported components for the preview.
`multi-seat.ts`, `table-format.ts`, `seat-strip.tsx`, `opponent-board.tsx`, `multi-seat-stage.tsx` stay. New code
calls `multi-seat.ts` helpers (`seatRelation`, `placementOrder`, `isEliminated`, `nextSeatAfter`,
`opponentPickOptions`, `focusOpponentSeat`, `winnerSeats`, `disabledZones`, `withoutSeatExtraKeys`) and
`table-format.ts` (`tagSeatCode`, `seatTeamLabel`, `formatStartingLp`). Do not re-implement them.

`field.tsx` change (3w-1, first commit): extract the per-seat body (`MonsterRow`, `SpellRow`, `PileColumn`, EMZ, hand,
Tally) into an exported `SeatField(props: SeatFieldProps)`. `DuelField` then renders two `SeatField`s and the shared EMZ
band exactly as today. `extraMonsterKeys` gets a mode: `"shared-bottom"|"shared-top"` (1v1, today) or `"own"` (3+ seats:
each seat has its own `<seat>:4:5` and `<seat>:4:6`). Check: existing field tests pass, /dev/fx-lab looks the same.

Seat geometry (`geometry.ts`). Stage is 1100×860, scaled to fit the board box (`stageFit`).
- ffa3: you S at 0°. Home: rivals at 66% scale, turned 158° and 202°. Focus: the focused rival goes across at 90%,
  the other docks at 46%. Look-from-seat: table turns 120°. Overview: true 120° spacing.
- ffa4: you S, Ice W, Verdant N, Rose E (clockwise from you, `placementOrder`). Rivals 50–60%, flanks turned 90°.
  Focus up to 92%, the other two dock at 50%. Look-from-seat turns 90/180/270°. Compact chips turn on below a
  44px rival card height (40px when the viewport is under 1440 wide), with a hover lens.
- tag: geometry comes from `tag/roof-camera.ts`; `geometry.ts` only exports the `tableLayout("tag")` seat slots.
- Upright (S): counter-rotate text, stats and labels so they read upright at any angle (`--up` CSS variable).
- Spectator: seat 0 sits at S, `relation:"other"`, no own hand face up, no USE glow.

Camera (`camera-model.ts`, pure). Modes `home | focus | look | overview | fly`. Keys: Tab / Shift+Tab focus next
or previous rival (a click on a rival also focuses it), P look from the focused seat, 0 or O overview, H home,
F fly-in toggle, 1..n fly to seat (in fly mode) or focus seat, S upright, C compact (ffa4), A auto, K keep pin.
Fly: drag orbits (yaw any, tilt 8–68°), wheel zooms 0.32–1.9. Auto camera follows the turn / prompt seat but
never moves while you aim, and a Keep pin always wins. FX lock: chain resolution, battle, direct attack,
destroy sweeps (Raigeki, Mirror Force) and elimination set `lock`; the effective pose eases to home (plaza pose
in fly mode); input is ignored until unlock; then the previous pose returns. Lock timing comes from event kinds
(`fxLockFor`), so the live wiring later needs no new data.

Holo LP: one panel per seat, placed at the projected box of its field (measured with `getBoundingClientRect` after
each pose change, `ResizeObserver` on the stage), with a dashed tether to the field. It uses `LifePoints`
(`size="sm"` for rivals). Elimination: the field greys by a seat-tone desaturate overlay label "Eliminated" (not a
card dim), the LP panel cracks, the ring skips the seat. Tag team loss: the team plate cracks, then the result.

## 2. `table/types.ts` (scaffold writes it exactly; later edits only by 3w-*, additive only)

```ts
import type { ReactNode } from "react";
import type { DuelAnswer, DuelEngineView, DuelEvent, DuelFormat, DuelMasterRule, DuelPrompt, DuelRoom } from "@yugidraft/shared/duels";
import type { BattleAim } from "../battle-fx";
import type { PromptDraft } from "../prompts";
import type { InspectTarget } from "../inspector";
import type { DuelActivateHandler, DuelHoverHandler } from "../field";
import type { SeatPick, SeatRelation } from "../multi-seat";
export type { BattleAim, PromptDraft, InspectTarget, DuelActivateHandler, DuelHoverHandler, SeatPick, SeatRelation };

export type TableFormat = Exclude<DuelFormat, "1v1">;            // "tag" | "ffa3" | "ffa4"
export type SeatTone = "violet" | "ice" | "verdant" | "rose";
export type Compass = "S" | "W" | "N" | "E";
export const SEAT_TONE_HEX: Readonly<Record<SeatTone, { main: string; ink: string }>> = {
  violet: { main: "#9b7eff", ink: "#c6b6ff" }, ice: { main: "#5cb8f5", ink: "#a9dcfb" },
  verdant: { main: "#8fd36b", ink: "#c4ecad" }, rose: { main: "#f08cc4", ink: "#fbc8e4" },
};

export interface SeatSlot {
  seat: number; relation: SeatRelation; tone: SeatTone; compass: Compass;
  baseAngleDeg: number;            // true table angle; 0 = viewer side, clockwise
  team: number | null;             // tag: seat % 2; ffa: null
  code: string | null;             // tag: "1A" | "2A" | "1B" | "2B" (tagSeatCode); ffa: null
  turnOrder: number;               // 0-based order in the turn ring
}
export interface TableLayout {
  format: TableFormat; viewerSeat: number | null; anchorSeat: number;   // anchor = viewer, or 0 for spectator
  slots: readonly SeatSlot[];      // viewer/anchor first, then placementOrder
  stage: { width: 1100; height: 860 };
}
export interface SeatPose {
  seat: number; x: number; y: number;        // field centre in stage px
  scale: number; rotateDeg: number;          // effective rotation (text counter-rotates when upright)
  z: number; docked: boolean; compact: boolean; hidden: boolean;
}

export type CameraMode = "home" | "focus" | "look" | "overview" | "fly";
export type CameraLockReason = "chain" | "battle" | "direct" | "destroy" | "elimination";
export interface FlyPose { yawDeg: number; tiltDeg: number; zoom: number; targetSeat: number | null }
export interface CameraState {
  mode: CameraMode; focusSeat: number | null; lookSeat: number | null;
  upright: boolean; compact: "auto" | "on" | "off"; auto: boolean; pinned: boolean; aiming: boolean;
  fly: FlyPose; lock: { reason: CameraLockReason; untilMs: number } | null;
}
export type CameraAction =
  | { type: "home" } | { type: "overview" } | { type: "focus"; seat: number } | { type: "focusStep"; dir: 1 | -1 }
  | { type: "look"; seat: number | null } | { type: "toggleFly" } | { type: "flyTo"; seat: number }
  | { type: "orbit"; dYawDeg: number; dTiltDeg: number } | { type: "zoom"; factor: number }
  | { type: "toggleUpright" } | { type: "toggleCompact" } | { type: "toggleAuto" } | { type: "pin"; on: boolean }
  | { type: "aiming"; on: boolean } | { type: "autoFollow"; seat: number | null }
  | { type: "lock"; reason: CameraLockReason; nowMs: number; ms: number } | { type: "tick"; nowMs: number };

export interface TargetChoice {
  seat: number; zones: readonly string[]; direct: boolean;   // direct = option to hit that seat's LP
  optionIds: readonly string[]; label: string;
}
export type SeatStatus = "active" | "turn" | "choosing" | "next" | "leaving" | "eliminated";

export interface SeatFieldProps {
  engine: DuelEngineView; seat: number; viewerSeat: number | null; masterRule: DuelMasterRule;
  side: "you" | "opp"; angleDeg: number; upright: boolean; tone: SeatTone;
  density: "full" | "rival" | "compact";
  hand: "face" | "backs" | "none";  emz: "own" | "shared-bottom" | "shared-top";
  showTally: boolean;               // false when a holo LP panel owns data-lp-seat
  usable: boolean;                  // false: legal ring only, no USE glow (partner, spectator)
  peekSetCards?: boolean;           // tag partner: set cards readable, eye chip
  legalKeys: Set<string>; selectedKeys: Set<string>; reducedMotion: boolean;
  onActivate: DuelActivateHandler; onInspect: (target: InspectTarget) => void; onHoverCard?: DuelHoverHandler;
}
export type SeatFieldRenderer = (props: SeatFieldProps) => ReactNode;

export interface TableController {
  room: DuelRoom; engine: DuelEngineView; viewerSeat: number | null; nameOf: (seat: number) => string;
  prompt: DuelPrompt | null; promptSeat: number | null; canAct: boolean; busy: boolean; revealed: boolean;
  draft: PromptDraft; legalKeys: Set<string>; selectedKeys: Set<string>;
  aim: BattleAim | null; seatPick: SeatPick | null; reducedMotion: boolean;
  onAnswer: (answer: DuelAnswer) => void; onActivate: DuelActivateHandler;
  onInspect: (target: InspectTarget) => void; onHoverCard?: DuelHoverHandler;
  onAim?: (to: BattleAim["to"] | null) => void;   // hover/lock an attack target
}
export interface TableStageProps {
  controller: TableController; layout: TableLayout;
  camera: CameraState; dispatchCamera: (action: CameraAction) => void;
  renderSeatField: SeatFieldRenderer;  // SeatField from field.tsx; a render prop so tag never imports table code
  fx?: ReactNode; promptCenter?: ReactNode; overlay?: ReactNode;   // slots: FxBoundary tree, PromptCenter, menus
}
export type TagStageProps = TableStageProps;
export type FxLockRule = (event: DuelEvent) => { reason: CameraLockReason; ms: number } | null;
```

Pure function signatures (implementations by 3w-*; tag must not import them before 3w-3 is done):
`tableLayout(format, engine, viewerSeat): TableLayout` · `seatPoses(layout, camera, viewport:{width,height}): Map<number, SeatPose>` ·
`stageFit(box:{width,height}): number` · `seatNormal(pose): {x,y}` · `cameraReducer(state, action, layout): CameraState` ·
`initialCamera(layout, partial?): CameraState` · `cameraActionForKey(e:{key,shiftKey}, layout, camera): CameraAction | null` ·
`fxLockFor: FxLockRule` · `effectiveMode(state, nowMs): CameraMode` · `targetChoices(prompt, engine, viewerSeat): TargetChoice[]` ·
`defaultTargetSeat(choices, camera): number | null` · `seatStatus(engine, seat, promptSeat): SeatStatus` ·
`teamLost(engine, team): boolean`.

## 3. 2v2 Rooftop (`tag/`, agent "tag")

Builds `TagStage(props: TagStageProps)` to match `2v2-a-rooftop.html` and `shots/2v2-a-*.png`:
- Team strips: your field + partner field joined with a bond line and ◆ medal; rival strip (Rose + Verdant, ●) at the
  far end. Team bands `--team-us: linear-gradient(90deg,#9b7eff,#5cb8f5)`, `--team-them: linear-gradient(90deg,#f08cc4,#8fd36b)`.
- Helipad hub: horizontal chain rail ("C2 · Corvin ◆ 1B"), the response-window line, the bow-tie turn baton 1A→2A→1B→2B.
- Team LP plates (shared 16000) with member chips (name, code, hand, deck, clock); `data-lp-seat` on each member chip
  (both seats of a team point at the same LP; FX reads either). Plate cracks on team loss, then "YOUR TEAM WINS".
- Partner hand face up with caption "Corvin's hand · only your team sees it" (`data-hand-seat` on it). Partner set
  cards peek with an eye chip. Partner cards: Ice "Partner" nib + legal ring, no USE glow (`usable:false`).
- Cameras in pure `roof-camera.ts` (own reducer, same `CameraState`/`CameraAction` types, extra mode via `look`):
  H home, 0 overview, I fly-in intro, 1–4 focus by turn order, V rival end, Q/E or drag orbit, scroll or +/− zoom,
  roof map. Honour `lock` exactly like section 1. Direct attack default: any rival member with no monster.
- Imports allowed: `table/types.ts`, the frozen scaffold files in `table/fixtures/` (common.ts,
  use-fixture-controller.ts, preview-harness.tsx), and any existing exported component outside `table/`
  (`LifePoints`, `CardFace`, `CardBack`, `UsableGlow`, `PromptCenter`, `ChainFx`, `multi-seat.ts`, `table-format.ts`,
  `constants.ts`, ...). It renders fields only through `props.renderSeatField`. It edits nothing outside `tag/**`,
  `tag/fixtures.ts` and `app/dev/table-preview/tag/**`. After 3w-3 is committed it may also import `geometry.ts`,
  `camera-model.ts`, `targets.ts`, `holo-lp.tsx`.

## 4. Fixtures and the dev preview route

State ids (every mode has all nine): `main`, `battle-aim`, `chain-2`, `target-pick`, `choose-opponent`,
`direct-attack`, `elimination`, `spectator`, `result`. Fixture files: ffa3 → `table/fixtures/ffa3.ts`,
ffa4 → `table/fixtures/ffa4.ts`, tag → `tag/fixtures.ts`. Data: ffa3 as `3way-final.html` (Ren Arata you, Ryo Sato Ice
5400, Mika Hana Verdant 2100 −1200, turn 5 BP, chain Mirror Force by Ryo / Call of the Haunted by Mika); ffa4 per
BRIEF-MODES 5.1; tag per BRIEF-MODES 5.2. No Swords of Revealing Light. Spectator = `role:"spectator"`, `mySeat:null`,
all hands hidden. Result = `engine.result` set (ffa: placings via elimination order; tag: `winnerTeam`).

`table/fixtures/common.ts` (scaffold):
```ts
import type { DuelChainLink, DuelEngineView, DuelEvent, DuelPrompt, DuelRoom, DuelSeatView } from "@yugidraft/shared/duels";
import { CARDS } from "../../fx-lab/cards";
export { newSeat, cardAt, hiddenAt, MZ, SZ, HAND, GY, BANISHED, DECK, EXTRA, FIELD, link } from "../../fx-lab/board";
import type { BattleAim, CameraState, TableFormat } from "../types";
export const TABLE_STATE_IDS = ["main","battle-aim","chain-2","target-pick","choose-opponent","direct-attack","elimination","spectator","result"] as const;
export type TableStateId = (typeof TABLE_STATE_IDS)[number];
export const TABLE_CARDS = { ...CARDS, callOfTheHaunted: /* 97077563 */, jinzo: /* 77585513 */, envoy: /* 72989439 */ };
export interface TableFixtureState { id: TableStateId; label: string; room: DuelRoom; ui?: { aim?: BattleAim | null; camera?: Partial<CameraState> } }
export interface TableFixtureSet { format: TableFormat; title: string; states: Readonly<Record<TableStateId, TableFixtureState>> }
export function fixtureEngine(o: { format: TableFormat; seats: DuelSeatView[]; turn: number; turnSeat: number; phase: string;
  battleStep?: DuelEngineView["battleStep"]; prompt?: DuelPrompt | null; chain?: DuelChainLink[]; events?: DuelEvent[];
  result?: DuelEngineView["result"] }): DuelEngineView;
export function fixtureRoom(o: { format: TableFormat; names: readonly string[]; viewerSeat: number | null;
  engine: DuelEngineView; clockMs?: readonly number[] }): DuelRoom;   // session.format/seats/status "active", metadataOnly false
```
Mode file skeleton (`ffa3.ts`; same shape for `ffa4.ts` and `tag/fixtures.ts`):
```ts
import { fixtureEngine, fixtureRoom, newSeat, cardAt, MZ, TABLE_CARDS as C, type TableFixtureSet } from "./common";
const NAMES = ["Ren Arata", "Ryo Sato", "Mika Hana"] as const;
function base(viewerSeat: number | null = 0) { /* seats, cards, LP */ }
export const FFA3_FIXTURES: TableFixtureSet = { format: "ffa3", title: "3-way free-for-all", states: {
  main: { id: "main", label: "Main Phase", room: fixtureRoom({ format: "ffa3", names: NAMES, viewerSeat: 0, engine: /* ... */ }) },
  /* battle-aim, chain-2, target-pick, choose-opponent, direct-attack, elimination, spectator, result */ } };
```
`table/fixtures/use-fixture-controller.ts` (scaffold): `useFixtureController(state: TableFixtureState):
TableController`. It uses `usePromptDraft`, `promptLegalKeys`, `promptSelectedKeys`, `opponentPickOptions`;
`onAnswer` logs `[table-preview] answer` to the console and shows a small "Answer sent (fixture)" toast; aim is local state seeded from `ui.aim`.
`table/fixtures/preview-harness.tsx` (scaffold, "use client"): `PreviewHarness({ set, stateId, cam, renderStage })`
with `renderStage: (controller: TableController, state: TableFixtureState) => ReactNode`. It draws a thin top bar
(state links, camera hint, viewport size) and the stage. URL query: `?state=<id>&cam=home|overview|fly|focus:<seat>|look:<seat>&lock=chain|battle|...&reduced=1`.

Route skeleton (each mode dir owned by its agent; scaffold creates all three with placeholder stages):
```tsx
// app/dev/table-preview/ffa3/page.tsx (server)
import type { Metadata } from "next"; import { notFound } from "next/navigation"; import { fxLabEnabled } from "@/lib/fx-lab";
import { Ffa3Preview } from "./preview";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Table preview · 3-way", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fxLabEnabled()) notFound();
  const q = await searchParams; const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  return <Ffa3Preview stateId={one(q.state)} cam={one(q.cam)} lock={one(q.lock)} />;
}
// app/dev/table-preview/ffa3/preview.tsx ("use client"): PreviewHarness + FFA3_FIXTURES + TableShell/TableStage
```
`app/dev/table-preview/page.tsx` lists links for 3 modes × 9 states. Auth: the routes live outside `(app)` (no
AppShell, no login), gated by `fxLabEnabled()` (on in `next dev` or with `DUEL_FX_LAB=1`; 404 in production).
Scaffold extends `isFxLabPublicPath` in `src/lib/fx-lab.ts` with `pathname === "/dev/table-preview" ||
pathname.startsWith("/dev/table-preview/")` so the `authorized` callback in `src/lib/auth.ts` lets the pages and the
card art through, and adds the two paths to `tests/auth-public-routes.test.ts` (open when on, closed when off).

## 5. File ownership

| Agent | Owns (creates/edits) | Must not edit |
|---|---|---|
| scaffold | `table/types.ts`, `table/fixtures/{common,use-fixture-controller,preview-harness}.ts(x)`, skeletons of `table/fixtures/ffa3.ts`, `table/fixtures/ffa4.ts`, `tag/fixtures.ts`, `app/dev/table-preview/**` skeletons, `src/lib/fx-lab.ts`, `tests/auth-public-routes.test.ts`, `packages/web/scripts/table-preview-shots.mjs`, dev server start | everything else |
| 3w-1 → 3w-2 → 3w-3 (in order) | `table/**` (except the three frozen fixture files), `table/fixtures/ffa3.ts`, `app/dev/table-preview/{page.tsx,ffa3/**}`, `field.tsx`, `field.module.css`, and optional-prop edits of shared duel components (`battle-fx`, `chain-fx`, `history-rail`, `station-track`, `duel-result`, `life-points`, `prompt-center`, `card-interactions`) | `room.tsx` (no wiring this phase), `tag/**`, `ffa4.ts`, `app/dev/table-preview/{ffa4,tag}/**` |
| tag (parallel) | `tag/**`, `tag/fixtures.ts`, `app/dev/table-preview/tag/**`, `tests/components/duel-tag-*.test.tsx`, `tests/tag-*.test.ts` | `table/**`, shared components, `field.tsx`, `room.tsx` |
| 4w (after 3w-3) | `table/fixtures/ffa4.ts`, `app/dev/table-preview/ffa4/**`; ffa4 branches inside `table/geometry.ts`, `camera-model.ts` and compact chip mode in `table/rival-field.tsx` (3w-* are done then) | `tag/**`, `room.tsx` |

Frozen after scaffold: `types.ts` and the three scaffold fixture files. Only 3w-* may make additive changes to them,
and must not break tag's imports. If tag needs a type change, it writes the request in its final report.

## 6. The three sequential 3-way steps

Step 3w-1: geometry, plaza, holo LP, rival fields, 3-way stage on fixtures.
- First commit: `SeatField` extraction in `field.tsx` (section 1), so tag can use it through `renderSeatField`.
- `geometry.ts` (home + upright for ffa3, slots for all formats), `plaza.tsx`, `holo-lp.tsx`, `rival-field.tsx`,
  `rival-hand.tsx`, `table-stage.tsx` (home pose only), `table-shell.tsx`, `table/fixtures/ffa3.ts` (all nine states).
- Done: /dev/table-preview/ffa3?state=main matches `shots/3w-final-final-1440.png` in layout; every seat has its own
  EMZ keys, one `data-lp-seat` per seat, `data-hand-seat` on rival hands, `data-zones` on every zone; S toggles
  upright; vitest for `geometry.ts`; existing field tests and 1v1 fx-lab view unchanged.

Step 3w-2: camera and aiming.
- `camera-model.ts` + `use-camera.ts` + `camera-controls.tsx`: focus (Tab/Shift+Tab/click), look-from-seat P,
  overview 0/O, home H, auto A, Keep pin, fly-in F (CSS 3D plaza; orbit drag, wheel zoom, 1/2/3 fly to seat),
  FX lock with "Camera locked · FX" chip. `turn-ring.tsx`, `targets.ts`, `attack-line.tsx`, `opponent-bar.tsx`.
- Battle aim: hover a target card or a holo LP (direct) sets `BattleAim.to`; click locks it; the camera does not move
  while aiming. Choose opponent uses `SeatPick` from the fixture prompt.
- Done: states `battle-aim`, `target-pick`, `choose-opponent`, `direct-attack` work; `?cam=fly` matches
  `3w-final-final-flyin.png`, `?cam=focus:1` matches `3w-final-final-focus.png`; vitest for every reducer action, the
  key map, the lock (input ignored, restore after), auto vs aiming vs pin, `targetChoices`.

Step 3w-3: port every remaining 1v1 feature, keyboard, 1280×720 fit.
- In `TableStage`/`TableShell`: `PromptCenter`, `PromptTray`, `CardActionMenu`, `AttackConfirm`, `CardHoverInfo`,
  `PileViewer` (per seat `seat` field), `CardInspector`, `DuelHistoryRail` (seat-tone tile edges, optional prop),
  `StationTrack` (seat strip + attack lock, optional props), `DeckMasterRail` per seat, `DuelResultScreen`
  (placings, optional prop), chain badges via `data-zones`, usable glow + top chip, elimination and spectator states,
  `seat-state.ts`, the FX slot (`FxBoundary` with `ChainFx`, `BattleFx`, `DestroyFx`, ... mounted unchanged).
- Keyboard: all camera keys, Esc/Enter as in 1v1, keys never fire inside inputs or while a menu is open.
- Done: all nine ffa3 states render with no console errors; at 1280×720 the hand row and station track are on
  screen (compare `3w-final-final-1280.png`); component test for `TableStage` on ffa3 fixtures (hooks present, one
  LP node per seat, glow on usable cards, no dim class); `npm run typecheck` and web tests green.

4w (after 3w-3): `ffa4.ts` (nine states), ffa4 poses (flanks 90°, focus 92%/dock 50%, look 90/180/270°), compact
chips + hover lens, keys 1–4 and 0. Done: matches `4ffa-b-final-1280/1440`, `4ffa-b-focus-1440`, `4ffa-b-flyin-1440`;
vitest for ffa4 geometry and compact threshold.

tag (parallel, start after scaffold): section 3. Done: nine tag states; matches `2v2-a-final-1280/1440`,
`2v2-a-attack-1440`, `2v2-a-overview-1440`; vitest for `roof-camera.ts` and team-loss logic; component test for
`TagStage` (hooks, partner no-glow, partner hand caption).

## 7. Test strategy

- Pure models: vitest in `packages/web/tests/table-*.test.ts` (3w/4w) and `tests/tag-*.test.ts` (tag).
  Run one file: `npx vitest run packages/web/tests/table-geometry.test.ts -c packages/web/vitest.config.ts`.
- Components: jsdom tests in `packages/web/tests/components/duel-table-*.test.tsx`, modelled on
  `duel-field-nseat.test.tsx` / `duel-multi-seat-board.test.tsx` (same `next/font/google` mock). Render the stage from
  fixture rooms; assert DOM hooks, glow chips, no dim, seat tones, prompt wiring.
- Screenshots: `node packages/web/scripts/table-preview-shots.mjs` (scaffold) uses `playwright` from the root
  `node_modules` (chromium in `~/.cache/ms-playwright`). Env: `PREVIEW_BASE` (default http://localhost:3100),
  `OUT_DIR` (required, your scratchpad), `MODES=ffa3,ffa4,tag`, `SIZES=1440x900,1280x720`. It also shoots
  `/dev/fx-lab` as the 1v1 guard. Compare by eye with the prototype `shots/` (Read both PNGs). No pixel test.
  Delete `OUT_DIR` when done.
- Always: `npm run typecheck` and `npm test --workspace=packages/web` before each commit. No `next build`.

## 8. Dev server

Use `next dev` on port 3100. First check: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/dev/table-preview`
(200 = ours is up). Then check the owner: `readlink /proc/$(ss -ltnp | grep ':3100 ' | grep -o 'pid=[0-9]*' | cut -d= -f2)/cwd`.
On 2026-10-01 port 3100 is held by a foreign stale `next-server` (production build, cwd deleted, from another
session). Do not kill it. If 3100 is foreign, use 3110 and set `PREVIEW_BASE=http://localhost:3110` everywhere.
Start (once, leave it running; scaffold does this):
```bash
cd /home/sulman633/orca/workspaces/yugioh-bot/n-player-ui
( set -a; . /home/sulman633/repos/yugioh-bot/.env; set +a
  export NEXTAUTH_URL=http://localhost:3100 AUTH_TRUST_HOST=true DUEL_FX_LAB=1 \
         CARD_IMAGE_CACHE_DIR=$PWD/data/card-images DATABASE_PATH=$PWD/data/bot.sqlite
  nohup npm run dev --workspace=@yugioh-discord-bot/web -- -p 3100 > "$SCRATCH/web-dev.log"   # SCRATCH = your scratchpad dir 2>&1 & )
```
The env is sourced from the main checkout's `.env` (read only); nothing is copied into the worktree and no secret is
committed. `NEXTAUTH_SECRET` is the only value the preview needs (middleware). `data/` is git-ignored. Card art is
fetched from YGOPRODeck on first use and cached in `data/card-images`. The preview needs no bot, ws or duel host.
Preview URL: http://localhost:3100/dev/table-preview (sub-routes `/ffa3`, `/ffa4`, `/tag`).

## 9. Not in scope

- Real-engine wiring of `TableStage` in `room.tsx` for live duels (the user does it later: swap `MultiSeatStage`
  for `TableStage` in the `multi` branch and build `TableController` from the state `room.tsx` already has).
- The Three.js FX port to N seats (`battle-fx` angles, `attack-fx` strike direction, `fx3d/coords`, `scene-plan`
  mirror normals). Keep every hook in section 0 so the port can be done later; only optional, default-off props.
- Engine, shared types, duel-server, bot, ws. 1v1 visuals. Production build or deploy.
