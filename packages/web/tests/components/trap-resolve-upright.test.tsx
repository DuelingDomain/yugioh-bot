// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelCardInfo, DuelEngineView, DuelEvent, DuelFormat, DuelSeatView } from "@yugidraft/shared/duels";
import { DuelField } from "@/components/duel/field";
import { SeatBoard } from "@/components/duel/opponent-board";
import { TableShell } from "@/components/duel/table/table-shell";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TagShell } from "@/components/duel/tag/tag-shell";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import { SummonFx } from "@/components/duel/summon-fx";
import { PositionFx } from "@/components/duel/position-fx";
import { ChainFx } from "@/components/duel/chain-fx";
import { MoveFx } from "@/components/duel/move-fx";
import { DuelFeedback } from "@/components/duel/feedback";
import { moveDestinationRotation } from "@/components/duel/event-queue";
import { chainBeatAt, resetChainBeats } from "@/components/duel/chain-beats";
import { clearZoneSnapshots, getMovePlan, resetMoveSchedule } from "@/components/duel/move-plan";
import { duelFxClock } from "@/components/duel/fx-clock";
import { setAnimationSpeed } from "@/components/duel/animation-speed";
import { cardGeometry } from "@/components/duel/fx3d/effects/shards";
import { CARDS } from "@/components/duel/fx-lab/cards";
import summonStyles from "@/components/duel/summon-fx.module.css";
import moveStyles from "@/components/duel/move-fx.module.css";

// Only the browser animation/frame/WebGL boundaries are replaced. Fields, shells and FX stay real.
vi.mock("@/components/duel/fx3d/use-fx3d", async () => {
  const { useRef } = await import("react");
  return { useFx3d: () => useRef(null) };
});

const key = "trap-upright";
const zone = { controller: 0, location: 0x08, sequence: 0 };
const callbacks = { legalKeys: new Set<string>(), selectedKeys: new Set<string>(), onActivate: vi.fn(), onInspect: vi.fn() };
const traps: DuelCardInfo[] = [
  { ...CARDS.mirrorForce, code: 12607053, name: "Waboku", type: 0x04 },
  { ...CARDS.mirrorForce, code: 85742772, name: "Gravity Bind", type: 0x20004 },
];
let animations: Array<{ element: Element; frames: Keyframe[] }>;

beforeEach(() => {
  vi.useFakeTimers();
  animations = [];
  window.localStorage.clear();
  resetChainBeats(key); resetMoveSchedule(key); clearZoneSnapshots();
  setAnimationSpeed(1); duelFxClock.setReducedMotion(false); duelFxClock.resetReviewTimeline();
  vi.stubGlobal("ResizeObserver", class { constructor(private cb: () => void) {} observe() { this.cb(); } disconnect() {} });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  // Orientation is in the generated keyframes; camera/tether frame loops need no simulated playback.
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1100);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(860);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const small = this.closest("[data-zones]") != null;
    return { left: 100, top: 100, width: small ? 70 : 1100, height: small ? 100 : 860,
      right: small ? 170 : 1200, bottom: small ? 200 : 960, x: 100, y: 100, toJSON() {} };
  });
  vi.stubGlobal("Animation", class {});
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: function (frames: Keyframe[]) {
    animations.push({ element: this, frames });
    return { finished: new Promise(() => {}), cancel() {}, playbackRate: 1 };
  } });
});
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else delete (Element.prototype as Partial<Element>).animate;
  setAnimationSpeed(1); duelFxClock.setReducedMotion(false); duelFxClock.resetReviewTimeline();
});

function engine(format: DuelFormat, card: DuelCard | null, events: DuelEvent[] = []): DuelEngineView {
  const count = format === "1v1" ? 2 : 4;
  const seats: DuelSeatView[] = Array.from({ length: count }, (_, seat) => ({
    seat, lp: 8000, hand: [], deckCount: 20, extraCount: 0, extra: [], graveyard: [], banished: [],
    monsters: Array<null>(7).fill(null), spells: Array<null>(8).fill(null),
  }));
  if (card) (card.location === 4 ? seats[0].monsters : seats[0].spells)[0] = card;
  const activated = events.some(e => e.kind === "activate");
  return { revision: events.length, format, turn: 2, turnSeat: 1, phase: "main1", seats,
    prompt: null, prioritySeat: null, chain: activated && !events.some(e => e.kind === "chain-end") ? [
      { index: 1, seat: 0, code: card?.code, name: card?.name, cardType: card?.type, zone },
    ] : [], events, log: [], result: null };
}

function Board({ view, viewer, reduced }: { view: DuelEngineView; viewer: number | null; reduced: boolean }) {
  const fixture = view.format === "tag" ? TAG_FIXTURES.states.main : FFA4_FIXTURES.states.main;
  const controller = useFixtureController({ ...fixture, room: { ...fixture.room, mySeat: viewer, engine: view,
    session: { ...fixture.room.session, slug: key } } }, { reducedMotion: reduced });
  if (view.format === "tag") return <TagShell controller={controller} />;
  if (view.format === "ffa4") return <TableShell controller={controller} />;
  return <div>
    <DuelField engine={view} mySeat={viewer} masterRule={5} bottomName="Local" topName="Opponent" reducedMotion={reduced} {...callbacks} />
    <SummonFx events={view.events} duelKey={key} reducedMotion={reduced} shake="off" />
    <PositionFx events={view.events} duelKey={key} reducedMotion={reduced} />
    <MoveFx events={view.events} duelKey={key} reducedMotion={reduced} />
    <ChainFx events={view.events} chain={view.chain} duelKey={key} reducedMotion={reduced} mySeat={viewer} playerName={s => `P${s}`} />
    <DuelFeedback events={view.events} duelKey={key} soundEnabled={false} reducedMotion={reduced} />
  </div>;
}

function upright(node: HTMLElement) {
  expect(node.dataset.defense).toBe("false");
  expect(node.querySelector('[data-defense="true"]')).toBeNull();
  expect(moveDestinationRotation(node) % 180).toBe(0);
}

for (const format of ["1v1", "ffa4", "tag"] as const) {
  const viewers = format === "1v1" ? [0, 1, null] : [0, 1, 2, 3, null];
  describe(`${format} Set Trap rendering`, () => {
    for (const viewer of viewers) for (const reduced of [false, true]) {
      it.each(traps)(`$name stays upright for viewer ${viewer} during activation/resolution (reduced=${reduced})`, card => {
        const set: DuelCard = { ...card, ...zone, position: 0x0a };
        const faceup = { ...set, position: 0x05 };
        let events: DuelEvent[] = [
          { id: 1, kind: "position", text: "flipped face-up", card, zone, fromPosition: 0x0a, toPosition: 0x05, flip: true },
          { id: 2, kind: "activate", text: "activating", seat: 0, card, zone, chainIndex: 1 },
        ];
        const result = render(<Board view={engine(format, set)} viewer={viewer} reduced={reduced} />);
        upright(result.container.querySelector<HTMLElement>('[data-zones~="0:8:0"]')!);
        result.rerender(<Board view={engine(format, faceup, events)} viewer={viewer} reduced={reduced} />);
        upright(result.container.querySelector<HTMLElement>('[data-zones~="0:8:0"]')!);
        const ghost = result.container.querySelector<HTMLElement>(`.${summonStyles.flipGhost}`)!;
        expect(ghost?.querySelector("img")?.getAttribute("src")).toContain(`/cards/${card.code}/image`);
        expect(parseFloat(ghost.parentElement!.style.width)).toBeLessThan(parseFloat(ghost.parentElement!.style.height));
        const flip = result.container.querySelector('[data-flip="reveal"]');
        if (!reduced) {
          expect(flip).not.toBeNull();
          const frames = animations.find(a => a.element === flip)!.frames;
          for (const frame of frames) expect(Number(String(frame.transform).match(/rotate\(([-\d.]+)deg\)/)![1]) % 180).toBe(0);
        }
        expect(result.container.querySelector('[data-feedback-cue][data-kind="activate"] img')).not.toBeNull();
        const strip = result.container.querySelector('[data-chain-strip]');
        if (strip) fireEvent.click(strip);
        expect(result.container.querySelector('[data-chain-hero] [data-chain-art]')).not.toBeNull();
        events = [...events, { id: 3, kind: "chain-resolving", text: "resolving", card, chainIndex: 1 }];
        result.rerender(<Board view={engine(format, faceup, events)} viewer={viewer} reduced={reduced} />);
        act(() => { vi.advanceTimersByTime(Math.max(0, chainBeatAt(3) - duelFxClock.now()) + 20); });
        expect(result.container.querySelector('[data-chain-front] [data-chain-link="1"]')?.getAttribute("data-status")).toBe("resolving");
        upright(result.container.querySelector<HTMLElement>('[data-zones~="0:8:0"]')!);
        events = [...events, { id: 4, kind: "chain-resolved", text: "resolved", card, chainIndex: 1 }];
        const stays = card.type === 0x20004;
        if (!stays) events = [...events, { id: 5, kind: "move", text: "cleanup", card, from: zone,
          // Also guard a caller that supplies SZONE's real position, even though the server omits it.
          fromPosition: 0x05, zone: { controller: 0, location: 0x10, sequence: 0 }, reason: "send" }];
        events = [...events, { id: 6, kind: "chain-end", text: "end" }];
        result.rerender(<Board view={engine(format, stays ? faceup : null, events)} viewer={viewer} reduced={reduced} />);
        if (stays) upright(result.container.querySelector<HTMLElement>('[data-zones~="0:8:0"]')!);
        else {
          act(() => { vi.advanceTimersByTime(Math.max(0, getMovePlan(5)!.startAt - duelFxClock.now()) + 20); });
          if (reduced) {
            const fade = result.container.querySelector<HTMLElement>(`.${moveStyles.ghost}[data-style="fade"]`)!;
            expect(fade?.querySelector("img")?.getAttribute("src")).toContain(`/cards/${card.code}/image`);
            expect(["none", "rotate(180deg)"]).toContain(fade.style.transform);
            return;
          }
          const flight = animations.find(a => String(a.frames[0]?.transform).startsWith("translate3d") &&
            a.element.querySelector(`img[src*="/cards/${card.code}/image"]`));
          expect(flight).toBeDefined();
          expect(Number(String(flight!.frames[0].transform).match(/rotate\(([-\d.]+)deg\)/)![1]) % 180).toBe(0);
        }
      });
    }
    it.each(viewers)("keeps a Trap Monster in defense after moving to MZONE for viewer %s", viewer => {
      const card: DuelCard = { ...traps[1], code: 26905245, name: "Metal Reflect Slime", ...zone, location: 4, position: 4, type: 0x20125 };
      const { container } = render(<Board view={engine(format, card)} viewer={viewer} reduced />);
      expect(container.querySelector('[data-zones~="0:4:0"]')?.getAttribute("data-defense")).toBe("true");
      expect(container.querySelector('[data-zones~="0:4:0"] [data-card-art]')?.getAttribute("data-defense")).toBe("true");
    });
  });
}

it.each([0x0a, 0x05])("keeps legacy opponent boards upright for SZONE position %s", position => {
  const card = { ...traps[1], ...zone, position };
  const view = engine("ffa4", card);
  const { container } = render(
    <SeatBoard view={view.seats[0]} name="Activator" relation="opponent" active={false} answering={false} callbacks={callbacks} reducedMotion />,
  );
  const nodes = container.querySelectorAll<HTMLElement>('[data-zones~="0:8:0"]');
  expect(nodes).toHaveLength(1);
  nodes.forEach(upright);
});

it("keeps fx3d Trap shards upright and defense monster shards sideways on either side", () => {
  for (const turned of [false, true]) {
    const half = turned ? Math.PI : 0;
    expect(cardGeometry({ x: 0, y: 0, w: 70, h: 100 }, false, turned)).toEqual({ w: 70, h: 100, base: half });
    expect(cardGeometry({ x: 0, y: 0, w: 100, h: 70 }, true, turned)).toEqual({ w: 70, h: 100, base: Math.PI / 2 + half });
  }
});
