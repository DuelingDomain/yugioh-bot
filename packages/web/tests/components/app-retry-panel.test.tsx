// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRetryPanel } from "../../src/components/layout/app-retry-panel";

afterEach(cleanup);

describe("AppRetryPanel", () => {
  it("keeps the copy and offers one Try again button that reloads", () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
    render(<AppRetryPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load your account. Try again in a moment.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
