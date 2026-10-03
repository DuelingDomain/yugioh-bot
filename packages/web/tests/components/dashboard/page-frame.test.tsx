// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageFrame } from "../../../src/components/dashboard/page-frame";

afterEach(cleanup);

describe("PageFrame", () => {
  it("tells the shell it owns the bar and puts the menu button last in the bar's actions", () => {
    const { container } = render(
      <PageFrame title="Tournaments" actions={<a href="/tournaments/new">New tournament</a>}>
        <p>Body</p>
      </PageFrame>,
    );
    expect(container.querySelector("[data-shell-bar='own']")).not.toBeNull();
    const actions = container.querySelector(".sv-bar-actions")!;
    expect(Array.from(actions.children).map((el) => el.tagName)).toEqual(["A", "BUTTON"]);
    expect(screen.getByRole("button", { name: /open menu/i })).toBeInTheDocument();
  });

  it("still shows the menu button on a page with no other actions", () => {
    render(<PageFrame title="Leaderboard"><p>Body</p></PageFrame>);
    expect(screen.getByRole("button", { name: /open menu/i })).toBeInTheDocument();
  });
});
