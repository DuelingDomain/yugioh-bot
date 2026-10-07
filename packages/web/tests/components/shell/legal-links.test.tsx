// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegalLinks } from "../../../src/components/layout/legal-links";
import { PRIVACY_URL, TERMS_URL } from "../../../src/components/auth/legal-links";

afterEach(cleanup);

describe("LegalLinks", () => {
  it("links Terms and Privacy to the marketing-site URLs in a new tab", () => {
    render(<LegalLinks />);
    const terms = screen.getByRole("link", { name: "Terms" });
    const privacy = screen.getByRole("link", { name: "Privacy" });
    expect(terms).toHaveAttribute("href", TERMS_URL);
    expect(privacy).toHaveAttribute("href", PRIVACY_URL);
    for (const link of [terms, privacy]) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("becomes two menu items inside a menu and reports navigation", () => {
    const onNavigate = vi.fn();
    render(<div role="menu"><LegalLinks menu onNavigate={onNavigate} /></div>);
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Terms", "Privacy"]);
    fireEvent.click(items[0]);
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});
