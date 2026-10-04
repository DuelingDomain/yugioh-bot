// @vitest-environment jsdom
import React from "react";
import { Blob } from "node:buffer";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Binder } from "../../../src/components/draft/room/binder";
import { EMPTY_FILTER, type RoomCard, type RoomFilter } from "../../../src/components/draft/room/room-model";

const card = (id: number, passcode: number, frameType = "normal"): RoomCard => ({
  id, passcode, frameType,
  name: `Card ${passcode}`,
  type: "Normal Monster",
  effectText: "",
  imageUrl: `/c/${passcode}.jpg`,
  imageUrlSmall: `/c/${passcode}s.jpg`,
});

function renderBinder(pool: RoomCard[], draftName = "Friday cube", phone = false, filter: RoomFilter = EMPTY_FILTER) {
  return render(
    <Binder
      draftName={draftName}
      pool={pool}
      theme={false}
      packCards={[]}
      filter={filter}
      onFilter={() => {}}
      pickConfig={{ theme: false, packSize: 8, cardsPerPlayer: 40 }}
      target={40}
      newId={null}
      phone={phone}
      onClose={() => {}}
      onPeek={() => {}}
    />,
  );
}

const createObjectURL = vi.fn((_: Blob) => "blob:picks");
const downloads: Array<{ filename: string; href: string }> = [];

beforeEach(() => {
  vi.useFakeTimers();
  createObjectURL.mockClear();
  downloads.length = 0;
  vi.stubGlobal("Blob", Blob);
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ filename: this.download, href: this.href });
  });
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("binder YDK export", () => {
  it.each([false, true])("exports all picks with passcodes and a Main/Extra split, phone=%s", async (phone) => {
    const picks = [
      card(1, 46986414),
      card(2, 24094653, "fusion"),
      card(3, 53183600, "spell"),
      card(4, 44508094, "synchro"),
      card(5, 44095762, "trap"),
      card(6, 84013237, "xyz"),
      card(7, 46986414),
      card(8, 1861629, "link"),
      card(9, 16178681, "fusion_pendulum"),
      card(10, 48461764, "synchro_pendulum"),
      card(11, 86238081, "xyz_pendulum"),
      card(12, 65518099, "normal_pendulum"),
      card(13, 13073850, "effect_pendulum"),
      card(14, 96747554, "ritual"),
    ];
    renderBinder(picks, "Friday cube", phone, { ...EMPTY_FILTER, q: "no match" });
    expect(screen.getByText("No cards match these filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "In order" }));

    const button = screen.getByRole("button", { name: "Export YDK" });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(downloads).toEqual([{ filename: "Friday cube picks.ydk", href: "blob:picks" }]);
    expect(await createObjectURL.mock.calls[0][0].text()).toBe(
      "#main\n46986414\n53183600\n44095762\n46986414\n65518099\n13073850\n96747554\n#extra\n24094653\n44508094\n84013237\n1861629\n16178681\n48461764\n86238081\n\n!side\n",
    );
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it.each([1, 45])("exports the current pool at %s picks", async (count) => {
    renderBinder(Array.from({ length: count }, (_, i) => card(i + 1, 46986414 + i)));

    fireEvent.click(screen.getByRole("button", { name: "Export YDK" }));

    const content = await createObjectURL.mock.calls[0][0].text();
    expect(content.split("\n").filter((line) => /^\d+$/.test(line))).toHaveLength(count);
    expect(downloads).toHaveLength(1);
  });

  it("exports three copies when the pool has a forced fourth pick", async () => {
    renderBinder(Array.from({ length: 4 }, (_, i) => card(i + 1, 46986414)));
    fireEvent.click(screen.getByRole("button", { name: "Export YDK" }));
    const content = await createObjectURL.mock.calls[0][0].text();
    expect(content.split("\n").filter((line) => line === "46986414")).toHaveLength(3);
  });

  it.each([
    { name: "  Fri<day>:/\\\"|?*\u0000\u001f\u007f cube  ", filename: "Friday cube picks.ydk" },
    { name: "<>:/\\\"|?*", filename: "Draft picks.ydk" },
    { name: "Dîner 東京", filename: "Dîner 東京 picks.ydk" },
  ])("downloads with a safe filename: $filename", ({ name, filename }) => {
    renderBinder([card(1, 46986414)], name);

    fireEvent.click(screen.getByRole("button", { name: "Export YDK" }));

    expect(downloads[0].filename).toBe(filename);
  });

  it("disables export when there are no picks", () => {
    renderBinder([]);

    const button = screen.getByRole("button", { name: "Export YDK" });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(downloads).toEqual([]);
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
