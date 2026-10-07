import "@testing-library/jest-dom";
import { vi } from "vitest";

// next/font/google is a build-time transform, so it can't run under Vitest. Pages now render
// inside SheetRoot, which loads the duel fonts, so every test gets this stub. A test file's
// own vi.mock of the module still takes precedence.
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return {
    Newsreader: font,
    Oxanium: font,
    Sofia_Sans_Extra_Condensed: font,
    Sofia_Sans_Semi_Condensed: font,
    Russo_One: font,
    Chakra_Petch: font,
    Barlow_Semi_Condensed: font,
    Barlow_Condensed: font,
  };
});

// Never initialize Clerk or perform Clerk I/O in unit/component tests.
vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));
