// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { HistoryRail, HistoryRow, HistoryTurn } from "@/components/sheet/history-rail";
import { DangerRow, DangerZone } from "@/components/sheet/danger-zone";
import { ConfirmPanel } from "@/components/sheet/confirm-panel";

describe("HistoryRail", () => {
  it("renders caption, list, turns and rows", () => {
    const { container } = render(
      <HistoryRail title="Results · 3" aside={<a href="#">Show all</a>}>
        <HistoryTurn>Thursday</HistoryTurn>
        <HistoryRow own="me" latest score="2–1" meta="+11">Imran beat Marik</HistoryRow>
        <HistoryRow chain thumb={<img alt="" />}>Waiting</HistoryRow>
        <HistoryRow own="none">Plain</HistoryRow>
      </HistoryRail>,
    );
    expect(screen.getByRole("heading", { level: 3, name: "Results · 3" })).toBeTruthy();
    expect(container.querySelector("section.hr")?.getAttribute("aria-labelledby")).toBe(screen.getByRole("heading").id);
    expect(container.querySelector(".hr-cap > a")).not.toBeNull();
    expect(container.querySelector("ol.hr-list > li.hr-turn")?.textContent).toBe("Thursday");
    const rows = container.querySelectorAll("li.hr-row");
    expect(rows[0].getAttribute("data-own")).toBe("me");
    expect(rows[0].hasAttribute("data-latest")).toBe(true);
    expect(rows[0].hasAttribute("data-chain")).toBe(false);
    expect(rows[0].querySelector(".hr-sc")?.textContent).toBe("2–1");
    expect(rows[0].querySelector(".hr-tx")?.textContent).toBe("Imran beat Marik");
    expect(rows[0].querySelector(".hr-mt")?.textContent).toBe("+11");
    expect(rows[1].hasAttribute("data-chain")).toBe(true);
    expect(rows[1].hasAttribute("data-own")).toBe(false);
    expect(rows[1].querySelector(".hr-th img")).not.toBeNull();
    expect(rows[1].querySelector(".hr-mt")).toBeNull();
    expect(rows[2].getAttribute("data-own")).toBe("none");
  });
});

describe("DangerZone", () => {
  it("renders the fence, rows and a default title", () => {
    const { container } = render(
      <DangerZone>
        <DangerRow title="End tournament now" description="Unplayed matches stay unplayed." action={<button className="btn btn-danger btn-sm">End now</button>} />
      </DangerZone>,
    );
    expect(container.querySelector(".dz-t")?.textContent).toBe("Danger zone");
    expect(container.querySelector(".dz")?.getAttribute("aria-labelledby")).toBe(container.querySelector(".dz-t")?.id);
    expect(container.querySelector(".dz-row p strong")?.textContent).toBe("End tournament now");
    expect(container.querySelector(".dz-row button")?.textContent).toBe("End now");
  });
});

describe("ConfirmPanel", () => {
  it.each(["Cancel", "End tournament"])("returns focus to a replaced trigger after %s closes the panel", async (closeLabel) => {
    function Confirmation() {
      const [open, setOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);
      return open ? (
        <ConfirmPanel
          title="End now?"
          confirmLabel="End tournament"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          returnFocusRef={triggerRef}
        />
      ) : <button ref={triggerRef} onClick={() => setOpen(true)}>End now</button>;
    }
    const user = userEvent.setup();
    render(<Confirmation />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    if (closeLabel === "End tournament") await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "End now" })).toHaveFocus();
  });

  it("restores the previously focused trigger when it stays mounted", async () => {
    function Confirmation() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>End now</button>
          {open && <ConfirmPanel title="End now?" confirmLabel="End tournament" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Confirmation />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "End now" })).toHaveFocus();
  });

  it("focuses cancel on mount and wires both buttons", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmPanel title="End now?" confirmLabel="End tournament" cancelLabel="Keep playing" onConfirm={onConfirm} onCancel={onCancel}>
        <p>The 6 left stay unplayed.</p>
      </ConfirmPanel>,
    );
    const cancel = screen.getByRole("button", { name: "Keep playing" });
    expect(document.activeElement).toBe(cancel);
    expect(container.querySelector(".cfm")?.getAttribute("role")).toBe("dialog");
    expect(container.querySelector(".cfm")?.getAttribute("aria-modal")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "End tournament" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons while busy", () => {
    render(<ConfirmPanel title="t" confirmLabel="Go" onConfirm={() => {}} onCancel={() => {}} busy />);
    expect((screen.getByRole("button", { name: "Go" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
