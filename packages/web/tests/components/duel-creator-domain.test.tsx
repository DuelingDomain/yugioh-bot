// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MULTI_DOMAIN_UNAVAILABLE_MESSAGE } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { DuelCreator } from "@/components/duel/creator";

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

describe("DuelCreator Domain rule", () => {
  it("offers Standard and Domain at a 1v1 table", () => {
    render(<DuelCreator />);
    expect(screen.getByLabelText("Domain")).toBeTruthy();
    expect(screen.queryByTestId("domain-blocked")).toBeNull();
  });

  it.each(["tag", "ffa3", "ffa4"])("hides Domain and says why at a %s table", (format) => {
    render(<DuelCreator />);
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: format } });
    expect(screen.queryByLabelText("Domain")).toBeNull();
    expect(screen.getByLabelText("Standard duel")).toBeTruthy();
    expect(screen.getByTestId("domain-blocked").textContent).toBe(MULTI_DOMAIN_UNAVAILABLE_MESSAGE);
  });

  it("goes back to Standard when the table type changes while Domain is chosen", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ session: { slug: "abc" } }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DuelCreator />);
    fireEvent.click(screen.getByLabelText("Domain"));
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "ffa3" } });
    fireEvent.click(screen.getByRole("button", { name: /Create game/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.format).toBe("ffa3");
    expect(body.mode).toBe("normal");
  });

  it("brings Domain back when the table type is 1v1 again", () => {
    render(<DuelCreator />);
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "tag" } });
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "1v1" } });
    expect(screen.getByLabelText("Domain")).toBeTruthy();
  });
});
