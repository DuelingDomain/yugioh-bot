// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createFieldCalibration } from "@yugidraft/vision";
import { projectRemoteState, ygoModule } from "@yugidraft/shared/remote";
import { FeedCards, FeedCardsProvider } from "@/components/remote/ui/feed-cards";
import { HoloField } from "@/components/remote/ui/holo-field";
import type { TwinCard } from "@/components/remote/ui/model";

afterEach(cleanup);
const calibration = createFieldCalibration([{ x: .08, y: .08 }, { x: .92, y: .08 }, { x: .92, y: .92 }, { x: .08, y: .92 }], { playerSide: "bottom", mirrored: false });
const card = (extra: Partial<TwinCard>): TwinCard => ({ ref: "c", zone: "monster", slot: 3, faceUp: true, position: "attack", ...extra }) as TwinCard;

it("draws a card another seat gave to this seat as a proxy on this seat's feed with art, ATK/DEF and a Controlled tag", () => {
  const info = () => ({ id: 86673403, name: "Angelechy Seneschal", type: "Effect Monster", atk: 1800, def: 1000 }) as never;
  const seats = [{ twin: [card({ ref: "own", cardId: 1, slot: 1 })] }, { twin: [card({ ref: "given", cardId: 86673403, ownerSeat: 0 }), card({ ref: "mine", cardId: 2, slot: 2 }), card({ ref: "down", slot: 4, faceUp: false, ownerSeat: 0 })] }];
  const view = (seat: number, read: () => typeof calibration | undefined) => render(
    <FeedCardsProvider seats={seats} info={info}><FeedCards seat={seat} frame={{ position: "absolute", inset: 0 }} format="normal" read={read} /></FeedCardsProvider>);
  const receiver = view(1, () => calibration);
  const [up, down] = screen.getAllByTestId("feed-proxy");
  expect(screen.getAllByTestId("feed-proxy")).toHaveLength(2);
  expect(up.getAttribute("data-face")).toBe("up");
  expect(down.getAttribute("data-face")).toBe("down"); expect(down.querySelector("image")).toBeNull();
  expect(up.querySelector("image")?.getAttribute("href")).toContain("/api/cards/86673403/image");
  const art = up.querySelector("image")!;
  expect(art.parentElement?.getAttribute("clip-path")).toMatch(/^url\(#.+\)$/);
  expect(screen.getAllByTestId("feed-proxy-tag").map(node => node.textContent)).toEqual(["Controlled (owned by Seat 1)", "Controlled (owned by Seat 1)"]);
  expect(screen.getAllByTestId("feed-stats").map(node => node.textContent)).toContain("1800/1000");
  receiver.unmount();
  view(0, () => calibration);
  expect(screen.queryByTestId("feed-proxy")).toBeNull();
  cleanup();
});

it("shows the giver their controlled card on the opponent's camera with or without peer calibration", () => {
  const initial = ygoModule.initialState({ seatCount: 2 });
  initial.seats[0].twin.push(card({ ref: "given", cardId: 86673403, name: "Angelechy Seneschal" }));
  const state = ygoModule.reduce(initial, { type: "twin.control", actorSeat: 0, seat: 0, toSeat: 1, cardRef: "given", zone: "monster", slot: 4, idempotencyKey: "give", at: 1 });
  const seats = projectRemoteState(state, new Set([0])).seats;
  const view = (read: () => typeof calibration | undefined) => (
    <FeedCardsProvider seats={seats} info={() => undefined} ownerName={() => "Giver"}>
      <FeedCards seat={1} frame={{ position: "absolute", inset: 0 }} format="normal" read={read} />
    </FeedCardsProvider>
  );
  const fallback = render(view(() => undefined));
  expect(screen.getByTestId("feed-proxy-fallback").querySelector("li")).toHaveAttribute("title", "Main Monster Zone 4 · Angelechy Seneschal · Controlled (owned by Giver)");
  expect(screen.getByTestId("feed-proxy-fallback")).toHaveTextContent("Angelechy Seneschal · Controlled (owned by Giver)");
  fallback.unmount();
  render(view(() => calibration));
  expect(screen.getByTestId("feed-proxy")).toHaveAttribute("data-zone", "M4");
  expect(screen.getByTestId("feed-proxy-tag")).toHaveTextContent("Controlled (owned by Giver)");
  render(<HoloField seat={1} name="Controller" twin={seats[1].twin} info={() => undefined} rv="m4" onRv={() => {}}
    picking={false} warnRefs={new Set()} onActivate={() => {}} onAttack={() => {}} onInspect={() => {}}
    owners={[{ seat: 0, name: "Giver", color: "gold" }]} />);
  expect(screen.getByRole("button", { name: /Controller, .*4.*Angelechy Seneschal.*owned by Giver/ })).toHaveAttribute("data-zone", "m4");
  expect(screen.getByTestId("owner-badge")).toHaveTextContent("Giver");
});
