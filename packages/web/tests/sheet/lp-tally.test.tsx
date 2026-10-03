// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LpTally } from "@/components/sheet/lp-tally";

describe("LpTally", () => {
  it("sets --n and renders label, value, delta and sub", () => {
    const { container } = render(
      <LpTally
        items={[
          { key: "elo", label: "Elo", aside: "Gold", value: 1184, delta: { text: "+11", dir: "up" }, sub: "166 to Platinum", tone: "tier", tier: "gold" },
          { key: "rec", label: "Record", value: 19, unit: "–13" },
          { key: "lp", label: "LP", value: 4000, was: 8000, delta: { text: "-4000", dir: "down" }, tone: "loss" },
          { key: "flat", label: "Place", value: "#5", delta: { text: "0", dir: "flat" } },
        ]}
      />,
    );
    const lps = container.querySelector(".lps") as HTMLElement;
    expect(lps.style.getPropertyValue("--n")).toBe("4");
    const lp = container.querySelectorAll(".lp");
    expect(lp).toHaveLength(4);
    expect(lp[0].getAttribute("data-tone")).toBe("tier");
    expect((lp[0] as HTMLElement).style.getPropertyValue("--tier")).toBe("var(--t-gold)");
    expect(lp[0].querySelector(".lp-k small")?.textContent).toBe("Gold");
    expect(lp[0].querySelector(".lp-v b")?.textContent).toBe("1184");
    expect(lp[0].querySelector(".lp-d")?.className).toBe("lp-d up");
    expect(lp[0].querySelector(".lp-s")?.textContent).toBe("166 to Platinum");
    expect(lp[1].querySelector(".lp-v b small")?.textContent).toBe("–13");
    expect(lp[1].querySelector(".lp-s")).toBeNull();
    expect(lp[2].getAttribute("data-tone")).toBe("loss");
    expect(lp[2].querySelector(".lp-v s")?.textContent).toBe("8000");
    expect(lp[2].querySelector(".lp-d")?.className).toBe("lp-d down");
    expect(lp[3].getAttribute("data-tone")).toBeNull();
    expect(lp[3].querySelector(".lp-d")?.className).toBe("lp-d flat");
  });

  it("maps long tier names to the stylesheet's tier variables", () => {
    const { container } = render(
      <LpTally items={[
        { key: "a", label: "Elo", value: 1, tone: "tier", tier: "Platinum" },
        { key: "b", label: "Elo", value: 1, tone: "tier", tier: "Diamond" },
      ]} />,
    );
    const lp = container.querySelectorAll<HTMLElement>(".lp");
    expect(lp[0].style.getPropertyValue("--tier")).toBe("var(--t-plat)");
    expect(lp[1].style.getPropertyValue("--tier")).toBe("var(--t-dia)");
  });
});
