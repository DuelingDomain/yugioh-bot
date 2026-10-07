// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SignInBanner, SignInErrorPanel } from "@/components/auth/sign-in-error";

afterEach(cleanup);

describe("SignInErrorPanel", () => {
  it("renders supplied title, body, actions and foot in the step slots", () => {
    const { container } = render(<SignInErrorPanel
      title={<>Access opens in <em>waves</em></>}
      body="Your invitation is on its way."
      action={<a href="/retry">Try again</a>}
      foot={<a href="/privacy">Privacy</a>}
    />);
    const title = screen.getByRole("heading", { level: 1, name: "Access opens in waves" });
    expect(title.querySelector("em")).toHaveTextContent("waves");
    screen.getByText("Closed alpha");
    screen.getByText("Your invitation is on its way.");
    expect(container.querySelector('[data-slot="form"]')).toContainElement(screen.getByRole("link", { name: "Try again" }));
    expect(container.querySelector('[data-slot="foot"]')).toContainElement(screen.getByRole("link", { name: "Privacy" }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("SignInBanner", () => {
  it("uses an info circle for info notices and a warning triangle for bad notices", () => {
    const { rerender } = render(<SignInBanner tone="info">You can try again.</SignInBanner>);
    const infoIcon = screen.getByRole("status").querySelector("svg");
    expect(infoIcon?.querySelector("circle")).toHaveAttribute("r", "9.5");
    expect(infoIcon?.querySelector("path")).toHaveAttribute("d", "M12 11v5.5M12 7.6v.1");

    rerender(<SignInBanner tone="bad">Try later.</SignInBanner>);
    const badIcon = screen.getByRole("alert").querySelector("svg");
    expect(badIcon?.querySelector("circle")).toBeNull();
    expect(badIcon?.querySelector("path")).toHaveAttribute("d", "M12 3 2.5 20h19Z");
  });

  it("announces bad notices as alerts with the supplied diagnostic code", () => {
    render(<SignInBanner tone="bad" code="SERVICE"><strong>Try later.</strong> Service unavailable.</SignInBanner>);
    const banner = screen.getByRole("alert");
    expect(banner).toHaveAttribute("data-tone", "bad");
    expect(banner).toHaveTextContent("Try later. Service unavailable.");
    expect(banner).toHaveAttribute("data-code", "SERVICE");
    expect(banner.textContent).toBe("Try later. Service unavailable.");
  });

  it("announces info politely and omits the code when absent", () => {
    render(<SignInBanner tone="info">You can try again.</SignInBanner>);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "info");
    expect(screen.getByRole("status")).toHaveTextContent("You can try again.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Error:/)).toBeNull();
  });
});
