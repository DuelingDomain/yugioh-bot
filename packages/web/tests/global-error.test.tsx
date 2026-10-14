// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import GlobalError from "../app/global-error";
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
it("renders a generic message without error details", () => {
  render(<GlobalError error={new Error("private diagnostic detail")} reset={() => {}} />);
  expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  expect(screen.queryByText("private diagnostic detail")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});
