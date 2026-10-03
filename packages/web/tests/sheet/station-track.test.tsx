// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StationTrack } from "@/components/sheet/station-track";

const stations = [
  { code: "LB", name: "Lobby" },
  { code: "PL", name: "9 of 15" },
  { code: "FN", name: "Final" },
];

describe("StationTrack", () => {
  it("marks done, current and next plates", () => {
    const { container } = render(<StationTrack stations={stations} current={1} tone="mine" caption={<span className="at">Your move</span>} />);
    const plates = container.querySelectorAll(".trk-plate");
    expect(plates).toHaveLength(3);
    expect(plates[0].getAttribute("data-state")).toBe("done");
    expect(plates[0].querySelector(".trk-tick svg.ic")).not.toBeNull();
    expect(plates[1].getAttribute("data-state")).toBe("current");
    expect(plates[1].getAttribute("aria-current")).toBe("step");
    expect(plates[1].querySelector(".trk-tick")).toBeNull();
    expect(plates[2].getAttribute("data-state")).toBeNull();
    expect(plates[2].getAttribute("data-next")).toBe("true");
    expect(container.querySelectorAll("[aria-current]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-next]")).toHaveLength(1);
  });

  it("sets tone, --i, caption, label and size classes", () => {
    const { container } = render(<StationTrack stations={stations} current={2} tone="live" size="sm" align="left" label="Match progress" caption="Final" />);
    const trk = container.firstElementChild as HTMLElement;
    expect(trk.className).toBe("trk sm left");
    expect(trk.getAttribute("data-tone")).toBe("live");
    expect(trk.style.getPropertyValue("--i")).toBe("2");
    expect(container.querySelector("ol")?.getAttribute("aria-label")).toBe("Match progress");
    expect(container.querySelector(".trk-cap")?.textContent).toBe("Final");
    expect(container.querySelector(".trk-pool")).not.toBeNull();
  });

  it("has no pool, no done plates and --i 0 when current is -1", () => {
    const { container } = render(<StationTrack stations={stations} current={-1} tone="theirs" />);
    const trk = container.firstElementChild as HTMLElement;
    expect(container.querySelector(".trk-pool")).toBeNull();
    expect(trk.style.getPropertyValue("--i")).toBe("0");
    expect(container.querySelectorAll('[data-state]')).toHaveLength(0);
    expect(container.querySelector("[aria-current]")).toBeNull();
    expect(container.querySelector(".trk-plate")?.getAttribute("data-next")).toBe("true");
    expect(container.querySelector(".trk-cap")).toBeNull();
    expect(container.querySelector("ol")?.getAttribute("aria-label")).toBe("Progress");
  });
});
