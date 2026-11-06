import "@testing-library/jest-dom";
import { vi } from "vitest";

// next/font/local is a build-time transform, so it can't run under Vitest.
// A test file's own vi.mock of the module still takes precedence.
vi.mock("next/font/local", () => ({
  default: () => ({ className: "font-class", variable: "font-var", style: {} }),
}));

// Never initialize Clerk or perform Clerk I/O in unit/component tests.
vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));
