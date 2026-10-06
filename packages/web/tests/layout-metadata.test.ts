import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Russo_One: font, Chakra_Petch: font };
});
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ DuelNavigationGuard: () => null }));
vi.mock("../app/globals.css", () => ({}));

import { metadata } from "../app/layout";

describe("root layout metadata", () => {
  it("titles the site Dueling Domain", () => {
    expect(metadata.title).toBe("Dueling Domain");
  });
});
