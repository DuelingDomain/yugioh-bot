// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AnnounceSearch } from "@/components/duel/prompts";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("includes the Manual seat in the card-name search request", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ cards: [] })));
  vi.stubGlobal("fetch", fetch);
  render(<AnnounceSearch slug="sandbox" sandbox={{ as: 3 }} cardCode={null} busy={false} onPick={() => {}} />);
  fireEvent.change(screen.getByLabelText("Search card name"), { target: { value: "Elf" } });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  const url = new URL(fetch.mock.calls[0][0], "http://local");
  expect(url.searchParams.get("as")).toBe("3");
  expect(url.searchParams.get("slug")).toBe("sandbox");
});
