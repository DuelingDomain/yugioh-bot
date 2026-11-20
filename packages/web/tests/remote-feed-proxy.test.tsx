// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createFieldCalibration } from "@yugidraft/vision";
import { FeedCards, FeedCardsProvider } from "@/components/remote/ui/feed-cards";
import type { TwinCard } from "@/components/remote/ui/model";

afterEach(cleanup);
const calibration = createFieldCalibration([{ x: .08, y: .08 }, { x: .92, y: .08 }, { x: .92, y: .92 }, { x: .08, y: .92 }], { playerSide: "bottom", mirrored: false });
const card = (extra: Partial<TwinCard>): TwinCard => ({ ref: "c", zone: "monster", slot: 3, faceUp: true, position: "attack", ...extra }) as TwinCard;

it("draws a card another seat gave to this seat as a proxy on this seat's feed: art, ATK/DEF and a Controlled tag; its own card gets none; no calibration draws nothing", () => {
  const info = () => ({ id: 86673403, name: "Angelechy Seneschal", type: "Effect Monster", atk: 1800, def: 1000 }) as never;
  const seats = [{ twin: [card({ ref: "own", cardId: 1, slot: 1 })] }, { twin: [card({ ref: "given", cardId: 86673403, ownerSeat: 0 }), card({ ref: "mine", cardId: 2, slot: 2 })] }];
  const view = (seat: number, read: () => typeof calibration | undefined) => render(
    <FeedCardsProvider seats={seats} info={info}><FeedCards seat={seat} frame={{ position: "absolute", inset: 0 }} format="normal" read={read} /></FeedCardsProvider>);
  const receiver = view(1, () => calibration);
  expect(screen.getAllByTestId("feed-proxy")).toHaveLength(1);
  expect(screen.getByTestId("feed-proxy").getAttribute("data-face")).toBe("up");
  expect(screen.getByTestId("feed-proxy").querySelector("image")?.getAttribute("href")).toContain("/api/cards/86673403/image");
  expect(screen.getByTestId("feed-proxy-tag").textContent).toBe("Controlled");
  expect(screen.getAllByTestId("feed-stats").map(node => node.textContent)).toContain("1800/1000");
  receiver.unmount();
  view(0, () => calibration);
  expect(screen.queryByTestId("feed-proxy")).toBeNull();
  cleanup();
  view(1, () => undefined);
  expect(screen.queryByTestId("feed-cards-1")).toBeNull();
});
