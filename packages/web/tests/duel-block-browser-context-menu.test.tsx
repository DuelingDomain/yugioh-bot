// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DUEL_NO_CALLOUT_ATTRIBUTE, useBlockBrowserContextMenu } from "@/lib/hooks/use-block-browser-context-menu";

function DuelRoot({ onOwnMenu }: { onOwnMenu: () => void }) {
  useBlockBrowserContextMenu();
  return (
    <div data-testid="root">
      <button type="button" data-testid="deck" onContextMenu={(event) => { event.preventDefault(); onOwnMenu(); }}>Deck</button>
      <button type="button" data-testid="stopper" onContextMenu={(event) => event.stopPropagation()}>Stops bubbling</button>
      <textarea data-testid="field" />
      <input data-testid="line" />
      <div data-testid="editable" contentEditable="true" suppressContentEditableWarning><span data-testid="editable-child">text</span></div>
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

  it("still prevents the native menu when a handler only calls stopPropagation", () => {
    const { getByTestId } = render(<DuelRoot onOwnMenu={() => {}} />);
    // React stops the native event at its root on stopPropagation; that must not leave the native menu open.
    expect(fireEvent.contextMenu(getByTestId("stopper"))).toBe(false);
  });

  it("keeps the native menu in text fields so players can paste", () => {
    const { getByTestId } = render(<DuelRoot onOwnMenu={() => {}} />);
    expect(fireEvent.contextMenu(getByTestId("field"))).toBe(true);
    expect(fireEvent.contextMenu(getByTestId("line"))).toBe(true);
    expect(fireEvent.contextMenu(getByTestId("editable-child"))).toBe(true);
  });

  it("is called by DuelRoomView, the root of every live duel surface", () => {
    const source = readFileSync(resolve(__dirname, "../src/components/duel/room.tsx"), "utf8");
    expect(source).toMatch(/import \{ useBlockBrowserContextMenu \} from "@\/lib\/hooks\/use-block-browser-context-menu"/);
    const body = source.slice(source.indexOf("export function DuelRoomView"));
    expect(body.slice(0, 1200)).toContain("useBlockBrowserContextMenu();");
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
