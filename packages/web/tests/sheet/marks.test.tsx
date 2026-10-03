// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChainMedallion, LivePill, NewChip, Stamp, SummonCircle, TierMeter } from "@/components/sheet/marks";

describe("ChainMedallion", () => {
  it("defaults to the chain tone with the link icon and no data-tone", () => {
    const { container } = render(<ChainMedallion label="2 replies owed" count={2} />);
    const cm = container.firstElementChild as HTMLElement;
    expect(cm.className).toBe("cm");
    expect(cm.getAttribute("data-tone")).toBeNull();
    expect(cm.getAttribute("role")).toBe("img");
    expect(cm.getAttribute("aria-label")).toBe("2 replies owed");
    expect(cm.querySelector("svg")).not.toBeNull();
    expect(cm.querySelector("b")?.textContent).toBe("2");
  });

  it("applies tone, size and a custom icon; omits the count when absent", () => {
    const { container } = render(<ChainMedallion tone="pen" size="sm" icon={<svg data-testid="swords" />} />);
    const cm = container.firstElementChild as HTMLElement;
    expect(cm.className).toBe("cm sm");
    expect(cm.getAttribute("data-tone")).toBe("pen");
    expect(cm.getAttribute("aria-hidden")).toBe("true");
    expect(cm.querySelector("[data-testid=swords]")).not.toBeNull();
    expect(cm.querySelector("b")).toBeNull();
    const xs = render(<ChainMedallion tone="live" size="xs" count={0} />).container.firstElementChild as HTMLElement;
    expect(xs.className).toBe("cm xs");
    expect(xs.getAttribute("data-tone")).toBe("live");
    expect(xs.querySelector("b")?.textContent).toBe("0");
  });
});

describe("small marks", () => {
  it("LivePill and NewChip have default text", () => {
    expect(render(<LivePill />).container.innerHTML).toBe('<span class="live-pill">Live</span>');
    expect(render(<NewChip />).container.innerHTML).toBe('<span class="chip-new">New</span>');
    expect(render(<LivePill>In progress</LivePill>).container.textContent).toBe("In progress");
  });

  it("Stamp renders a p by default, with loss", () => {
    expect(render(<Stamp>Champion</Stamp>).container.innerHTML).toBe('<p class="stamp">Champion</p>');
    expect(render(<Stamp loss as="span">Defeat</Stamp>).container.innerHTML).toBe('<span class="stamp loss">Defeat</span>');
  });

  it("TierMeter clamps the value and exposes the tier", () => {
    const m = (v: number) => render(<TierMeter tier="Gold" value={v} label="Gold meter" />).container.firstElementChild as HTMLElement;
    expect(m(0.62).getAttribute("data-t")).toBe("Gold");
    expect(m(0.62).getAttribute("role")).toBe("img");
    expect(m(0.62).getAttribute("aria-label")).toBe("Gold meter");
    expect((m(0.62).firstElementChild as HTMLElement).style.width).toBe("62%");
    expect((m(7).firstElementChild as HTMLElement).style.width).toBe("100%");
    expect((m(-1).firstElementChild as HTMLElement).style.width).toBe("0%");
    expect((m(NaN).firstElementChild as HTMLElement).style.width).toBe("0%");
  });

  it("SummonCircle is decorative and has both rings", () => {
    const { container } = render(<SummonCircle />);
    const smn = container.firstElementChild as HTMLElement;
    expect(smn.className).toBe("smn");
    expect(smn.getAttribute("aria-hidden")).toBe("true");
    expect(smn.querySelector("g.r1")).not.toBeNull();
    expect(smn.querySelector("g.r2")).not.toBeNull();
  });
});
