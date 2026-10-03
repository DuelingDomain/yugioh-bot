// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { DuelCreator } from "@/components/duel/creator";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tables = ["normal", "domain"].flatMap((mode) =>
  ["tag", "ffa3", "ffa4"].map((format) => ({ mode, format })),
);

function chooseMode(mode: string) {
  if (mode === "domain") fireEvent.click(screen.getByLabelText("Domain"));
}

function masterRules() {
  return screen.getByLabelText("Master Rules") as HTMLSelectElement;
}

describe("DuelCreator Master Rules", () => {
  it.each(tables)("offers only MR5 for $mode $format", ({ mode, format }) => {
    render(<DuelCreator multiplayerTables multiCoreReady multiDomainCoreReady />);
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: format } });
    chooseMode(mode);

    expect([...masterRules().options].map((option) => option.value)).toEqual(["5"]);
    expect(masterRules()).toHaveValue("5");
    expect(masterRules()).toBeDisabled();
    expect(document.body.textContent).not.toMatch(/Master Rules? [1-4]|MR[1-4]/);
  });

  it.each(tables.flatMap((table) => [1, 2, 3, 4].map((rule) => ({ ...table, rule }))))(
    "resets and submits MR$rule as MR5 when $mode changes to $format",
    async ({ mode, format, rule }) => {
      const fetchMock = vi.fn().mockResolvedValue(Response.json({ session: { slug: "abc" } }, { status: 201 }));
      vi.stubGlobal("fetch", fetchMock);
      render(<DuelCreator multiplayerTables multiCoreReady multiDomainCoreReady />);
      chooseMode(mode);
      fireEvent.change(masterRules(), { target: { value: String(rule) } });
      expect(masterRules()).toHaveValue(String(rule));

      fireEvent.change(screen.getByLabelText("Table type"), { target: { value: format } });
      expect(masterRules()).toHaveValue("5");
      fireEvent.click(screen.getByRole("button", { name: /Create game/ }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ mode, format, masterRule: 5 });
    },
  );

  it.each(["normal", "domain"])("keeps all rules and the user's selection for %s 1v1", (mode) => {
    render(<DuelCreator multiplayerTables multiCoreReady multiDomainCoreReady />);
    chooseMode(mode);
    expect([...masterRules().options].map((option) => option.value)).toEqual(["5", "4", "3", "2", "1"]);
    expect(masterRules()).toBeEnabled();

    for (const rule of [1, 2, 3, 4, 5]) {
      fireEvent.change(masterRules(), { target: { value: String(rule) } });
      fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "1v1" } });
      expect(masterRules()).toHaveValue(String(rule));
    }
  });

  it.each(tables)("restores all options when $mode $format returns to 1v1", ({ mode, format }) => {
    render(<DuelCreator multiplayerTables multiCoreReady multiDomainCoreReady />);
    chooseMode(mode);
    fireEvent.change(masterRules(), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: format } });
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "1v1" } });

    expect(masterRules()).toHaveValue("5");
    expect(masterRules()).toBeEnabled();
    expect([...masterRules().options].map((option) => option.value)).toEqual(["5", "4", "3", "2", "1"]);
    fireEvent.change(masterRules(), { target: { value: "3" } });
    expect(masterRules()).toHaveValue("3");
  });
});
