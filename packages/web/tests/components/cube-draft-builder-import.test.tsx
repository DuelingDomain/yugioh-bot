// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CubeDraftBuilder } from "../../src/components/cubes/cube-draft-builder";

vi.mock("../../src/components/cubes/cube-lobby-panel", () => ({
  CubeLobbyPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function stub(attach: () => Response) {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> | undefined }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "/api/cubes" && method === "GET") return Response.json({ cubes: [] });
      if (url === "/api/cubes" && method === "POST") {
        return Response.json(
          { cube: { id: 42, name: "Flip" }, added: 2, copies: 4, unknown: ["Engines"], corrected: [{ from: "Scapegost", to: "Scapeghost" }] },
          { status: 201 },
        );
      }
      if (url === "/api/drafts/abc/cubes" && method === "POST") return attach();
      return Response.json({}, { status: 404 });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderBuilder(onChanged = vi.fn()) {
  render(<CubeDraftBuilder slug="abc" allowedCubes={[]} uniqueThemes={false} onChanged={onChanged} />);
  return onChanged;
}

describe("theme lobby: import a list", () => {
  it("makes a theme cube from the list, attaches it to the draft and shows the diagnostics", async () => {
    const calls = stub(() => Response.json({ cube: { id: 42, name: "Flip" }, allowedCubeIds: [42] }, { status: 201 }));
    const onChanged = renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Import a list" }));
    const form = screen.getByRole("region", { name: "Import a list as a new cube" });
    // The draft decides the type, so no type picker.
    expect(within(form).queryByRole("group", { name: "Cube type" })).toBeNull();
    fireEvent.change(within(form).getByLabelText("Card list"), { target: { value: "Engines\n3 Scapegost" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create cube from list" }));

    const status = await screen.findByRole("status", { name: "Imported theme" });
    expect(status).toHaveTextContent("Added Flip to this draft. Added 2 cards, 4 copies.");
    expect(within(status).getByRole("list", { name: "Corrected names" })).toHaveTextContent("Scapeghost");
    expect(within(status).getByText("Skipped 1 line that is not a card name")).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/api/cubes" && c.method === "POST")?.body).toEqual({
      kind: "list",
      name: "New cube",
      importText: "Engines\n3 Scapegost",
      draftType: "theme",
    });
    expect(calls.find((c) => c.url === "/api/drafts/abc/cubes")?.body).toEqual({ kind: "existing", cubeId: 42 });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Import a list as a new cube" })).toBeNull();
  });

  it("says the cube was made but not attached when the draft refuses it", async () => {
    stub(() => Response.json({ error: "That cube is already in this draft" }, { status: 409 }));
    const onChanged = renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Import a list" }));
    const form = screen.getByRole("region", { name: "Import a list as a new cube" });
    fireEvent.change(within(form).getByLabelText("Card list"), { target: { value: "3 Scapegost" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create cube from list" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Made "Flip" in your library, but couldn't add it to this draft/));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
