// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rememberHistorySearch } from "../../src/components/duel/history-filters";
import { useMatchHistoryHref } from "../../src/components/duel/history-link";

function Probe() {
  return <a href={useMatchHistoryHref()}>Match history</a>;
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => cleanup());

describe("Match history link of the replay page", () => {
  it("goes to the plain history when nothing is saved", () => {
    render(<Probe />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/duels?view=history");
  });

  it("goes back with the filters the user last used", async () => {
    rememberHistorySearch("?view=history&scope=all&format=tag&q=Imran");
    render(<Probe />);
    await waitFor(() => expect(screen.getByRole("link")).toHaveAttribute("href", "/duels?view=history&scope=all&format=tag&q=Imran"));
  });

  it("drops bad saved values", async () => {
    rememberHistorySearch("?view=history&from=nope&format=ffa9&evil=1&q=Ok");
    render(<Probe />);
    await waitFor(() => expect(screen.getByRole("link")).toHaveAttribute("href", "/duels?view=history&q=Ok"));
  });
});
