// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DUEL_NO_CALLOUT_ATTRIBUTE, useBlockBrowserContextMenu } from "@/lib/hooks/use-block-browser-context-menu";

function DuelRoot({ onOwnMenu }: { onOwnMenu: () => void }) {
  useBlockBrowserContextMenu();
  return (
    <div data-testid="root">
      <button type="button" data-testid="deck" onContextMenu={(event) => { event.preventDefault(); onOwnMenu(); }}>Deck</button>
      <p data-testid="empty">empty space</p>
    </div>
  );
}

afterEach(cleanup);

describe("useBlockBrowserContextMenu", () => {
  it("prevents the native menu anywhere inside the duel page", () => {
    const { getByTestId } = render(<DuelRoot onOwnMenu={() => {}} />);
    expect(fireEvent.contextMenu(getByTestId("empty"))).toBe(false);
    expect(fireEvent.contextMenu(getByTestId("root"))).toBe(false);
    expect(fireEvent.contextMenu(document.body)).toBe(false);
  });

  it("lets our own onContextMenu handlers fire and keeps the event bubbling", () => {
    const own = vi.fn();
    const reached = vi.fn();
    document.addEventListener("contextmenu", reached);
    const { getByTestId } = render(<DuelRoot onOwnMenu={own} />);
    const notPrevented = fireEvent.contextMenu(getByTestId("deck"));
    document.removeEventListener("contextmenu", reached);
    expect(own).toHaveBeenCalledTimes(1);
    expect(reached).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  it("turns off the iOS callout while mounted and restores it after", () => {
    const { unmount } = render(<DuelRoot onOwnMenu={() => {}} />);
    expect(document.documentElement.hasAttribute(DUEL_NO_CALLOUT_ATTRIBUTE)).toBe(true);
    unmount();
    expect(document.documentElement.hasAttribute(DUEL_NO_CALLOUT_ATTRIBUTE)).toBe(false);
  });

  it("leaves the normal browser menu on other pages after unmount", () => {
    const { unmount } = render(<DuelRoot onOwnMenu={() => {}} />);
    unmount();
    const page = document.createElement("div");
    document.body.append(page);
    expect(fireEvent.contextMenu(page)).toBe(true);
    page.remove();
  });
});
