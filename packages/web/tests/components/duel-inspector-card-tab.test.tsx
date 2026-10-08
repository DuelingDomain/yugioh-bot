// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DuelCard } from "@yugidraft/shared/duels";
import { LOCATION_MZONE, POS_FACEUP_ATTACK } from "@/components/duel/constants";
import { CardInspector } from "@/components/duel/inspector";

const card: DuelCard = {
  controller: 0, location: LOCATION_MZONE, sequence: 1, position: POS_FACEUP_ATTACK, code: 11, name: "Blue-Eyes White Dragon",
  description: "This legendary dragon is a powerful engine of destruction. ".repeat(20),
};

// jsdom drops mask-image and scrollbar-width, so the test reads the data flag that the same code sets with the mask.
/** Make the nearest scroller report a size, as jsdom does no layout. */
function sizeScroller(el: HTMLElement, sizes: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => sizes.scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => sizes.clientHeight });
}

afterEach(cleanup);

describe("Card tab", () => {
  it("lays the art beside the name and stats and the text below", () => {
    const { container } = render(<CardInspector target={{ type: "card", card }} />);
    const root = container.querySelector('[data-header="side"]');
    expect(root).not.toBeNull();
    expect(root?.textContent).toContain("This legendary dragon");
  });

  it("fades the bottom of the scroller while the text has more to read, and clears it at the end", () => {
    const { container } = render(<div data-testid="scroller" style={{ overflowY: "auto" }}><span /></div>);
    const scroller = container.firstElementChild as HTMLElement;
    sizeScroller(scroller, { scrollHeight: 600, clientHeight: 300 });
    const { unmount } = render(<CardInspector target={{ type: "card", card }} />, { container: scroller });
    expect(scroller.dataset.cardMore).toBe("true");

    scroller.scrollTop = 300;
    act(() => { scroller.dispatchEvent(new Event("scroll")); });
    expect(scroller.dataset.cardMore).toBe("false");

    unmount();
    expect(scroller.dataset.cardMore).toBeUndefined();
  });

  it("shows no fade when the text fits", () => {
    const { container } = render(<div style={{ overflowY: "auto" }}><span /></div>);
    const scroller = container.firstElementChild as HTMLElement;
    sizeScroller(scroller, { scrollHeight: 300, clientHeight: 300 });
    render(<CardInspector target={{ type: "card", card }} />, { container: scroller });
    expect(scroller.dataset.cardMore).toBe("false");
  });
});
