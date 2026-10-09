// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardImg } from "@/components/draft/room/card-img";
import type { RoomCard } from "@/components/draft/room/room-model";

const card = { id: 1, passcode: 46986414, name: "Dark Magician" } as RoomCard;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("draft room card image loading state", () => {
  it("shows a card back while the picture loads, then fades the picture in", () => {
    const { container } = render(<CardImg card={card} eager placeholder="main" />);
    const img = container.querySelector("img")!;
    expect(container.querySelector(".img-wait")).not.toBeNull();
    expect(img.hasAttribute("data-loaded")).toBe(false);
    expect(img.getAttribute("loading")).toBe("eager");

    fireEvent.load(img);
    expect(container.querySelector(".img-wait")).toBeNull();
    expect(container.querySelector("img")!.hasAttribute("data-loaded")).toBe(true);
  });

  it("uses the extra deck back for extra deck cards", () => {
    const { container } = render(<CardImg card={card} placeholder="extra" />);
    expect(container.querySelector(".img-wait.x")).not.toBeNull();
  });

  it("draws no placeholder unless asked", () => {
    const { container } = render(<CardImg card={card} />);
    expect(container.querySelector(".img-wait")).toBeNull();
  });

  it("tries the other size when the first fails, still loading, then shows the card name", () => {
    const { container } = render(<CardImg card={card} placeholder="main" />);
    fireEvent.error(container.querySelector("img")!);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toContain("variant=full");
    expect(container.querySelector(".img-wait")).not.toBeNull();

    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".img-wait")).toBeNull();
    const miss = container.querySelector(".img-miss")!;
    expect(miss.textContent).toBe("Dark Magician");
    expect(miss.getAttribute("aria-label")).toBe("Dark Magician");
  });

  it("shows a picture that the browser cache finished before the page mounted as loaded", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(421);
    const { container } = render(<CardImg card={card} placeholder="main" />);
    expect(container.querySelector(".img-wait")).toBeNull();
    expect(container.querySelector("img")!.hasAttribute("data-loaded")).toBe(true);
  });

  it("keeps the placeholder for a picture that is complete but empty", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    const { container } = render(<CardImg card={card} placeholder="main" />);
    expect(container.querySelector(".img-wait")).not.toBeNull();
  });
});
