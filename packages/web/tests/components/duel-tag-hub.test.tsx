// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelipadHub } from "@/components/duel/tag/helipad-hub";

afterEach(cleanup);

function mountHub(onPick: (seat: number) => void) {
  return render(
    <HelipadHub
      chain={[]}
      anchorSeat={0}
      nameOf={(seat) => `Seat ${seat}`}
      toneOf={() => ({ rgb: "155 126 255", ink: "#c6b6ff" })}
      response={null}
      teamLabel={(team) => `Team ${team}`}
      pick={{ seats: [1, 3], onPick, title: "Choose a rival" }}
    />,
  );
}

describe("HelipadHub digit keys", () => {
  it("picks the rival of the digit once", () => {
    const onPick = vi.fn();
    mountHub(onPick);
    fireEvent.keyDown(window, { key: "2" });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(3);
  });

  it("stands down when another handler (the prompt tray) already took the key", () => {
    const onPick = vi.fn();
    const first = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener("keydown", first);
    mountHub(onPick);
    fireEvent.keyDown(window, { key: "1" });
    window.removeEventListener("keydown", first);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("takes the key first when it fires first, so a later handler sees it prevented", () => {
    const onPick = vi.fn();
    mountHub(onPick);
    const later = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
    window.addEventListener("keydown", later);
    fireEvent.keyDown(window, { key: "1" });
    window.removeEventListener("keydown", later);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(later).toHaveReturnedWith(true);
  });
});
