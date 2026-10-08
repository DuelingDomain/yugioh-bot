// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CubesLibraryList } from "../../src/components/cubes/cubes-library-list";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const EXISTING = { id: 1, name: "Goat cube", archetype: null, draftType: "booster", mainCount: 40, extraCount: 0 };

interface Posted {
  body: Record<string, unknown>;
}

function stub(create: (body: Record<string, unknown>) => Response, cubes = [EXISTING]) {
  const posts: Posted[] = [];
  let list = cubes;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/cubes" && method === "GET") return Response.json({ cubes: list });
      if (url === "/api/cubes" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        posts.push({ body });
        const res = create(body);
        if (res.status === 201) list = [...list, { ...EXISTING, id: 9, name: String(body.name) }];
        return res;
      }
      return Response.json({}, { status: 404 });
    }),
  );
  return posts;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function openImport() {
  render(<CubesLibraryList />);
  fireEvent.click(await screen.findByRole("button", { name: "Import a list" }));
  return screen.getByRole("region", { name: "Import a list as a new cube" });
}

describe("cubes library: import a list", () => {
  it("creates a cube from pasted text, then shows the result and diagnostics beside an Open link", async () => {
    const posts = stub(() =>
      Response.json(
        {
          cube: { id: 9, name: "Flip" },
          added: 12,
          copies: 31,
          unknown: ["Engines", "Glue"],
          corrected: [{ from: "Artifact Moraltech", to: "Artifact Moralltach" }],
        },
        { status: 201 },
      ),
    );
    const form = await openImport();
    expect(within(form).getByLabelText("Cube name")).toHaveValue("New cube");
    fireEvent.change(within(form).getByLabelText("Cube name"), { target: { value: "Flip" } });
    fireEvent.click(within(form).getByRole("button", { name: "Cube draft" }));
    fireEvent.change(within(form).getByLabelText("Card list"), { target: { value: "Engines\n3 Dark Hole\nGlue" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create cube from list" }));

    const result = await screen.findByRole("status", { name: "Imported cube" });
    expect(posts[0].body).toEqual({ kind: "list", name: "Flip", importText: "Engines\n3 Dark Hole\nGlue", draftType: "booster" });
    expect(result).toHaveTextContent("Created Flip. Added 12 cards, 31 copies.");
    expect(within(result).getByText("Skipped 2 lines that are not card names")).toBeInTheDocument();
    expect(within(result).getByRole("list", { name: "Corrected names" })).toHaveTextContent("Artifact Moralltach");
    expect(within(result).getByRole("link", { name: "Open cube" })).toHaveAttribute("href", "/cubes/9");
    // The form is gone and the library lists the new cube.
    expect(screen.queryByRole("region", { name: "Import a list as a new cube" })).toBeNull();
    expect(await screen.findByRole("link", { name: "Flip" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("loads a file into the box and creates only on the next click", async () => {
    const posts = stub(() => Response.json({ cube: { id: 9, name: "New cube" }, added: 1, copies: 3, unknown: [], corrected: [] }, { status: 201 }));
    const form = await openImport();
    const file = new File(["3 Dark Hole\n"], "Flip.txt", { type: "text/plain" });
    fireEvent.change(within(form).getByLabelText("Upload card list file"), { target: { files: [file] } });
    await waitFor(() => expect(within(form).getByLabelText("Card list")).toHaveValue("3 Dark Hole\n"));
    expect(within(form).getByText("Loaded Flip.txt, 1 line. Check it, then create the cube.")).toBeInTheDocument();
    expect(posts).toHaveLength(0);

    fireEvent.click(within(form).getByRole("button", { name: "Create cube from list" }));
    await screen.findByRole("status", { name: "Imported cube" });
    expect(posts[0].body).toMatchObject({ kind: "list", importText: "3 Dark Hole\n", draftType: "any" });
  });

  it("keeps the form and shows the server's message with the skipped lines when no card is found", async () => {
    stub(() => Response.json({ error: "No cards found in that list.", added: 0, copies: 0, unknown: ["Glue"], corrected: [] }, { status: 400 }));
    const form = await openImport();
    fireEvent.change(within(form).getByLabelText("Card list"), { target: { value: "Glue" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create cube from list" }));

    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent("No cards found in that list.");
    expect(within(alert).getByText("Skipped 1 line that is not a card name")).toBeInTheDocument();
    expect(within(form).getByLabelText("Card list")).toHaveValue("Glue");
  });

  it("shows a taken name and asks for text before it sends anything", async () => {
    const posts = stub(() => Response.json({ error: "A cube with that name already exists." }, { status: 409 }));
    const form = await openImport();
    fireEvent.click(within(form).getByRole("button", { name: "Create cube from list" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Load a file or paste a card list first.");
    expect(posts).toHaveLength(0);

    fireEvent.change(within(form).getByLabelText("Card list"), { target: { value: "3 Dark Hole" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create cube from list" }));
    await waitFor(() => expect(within(form).getByRole("alert")).toHaveTextContent("A cube with that name already exists."));
    expect(posts).toHaveLength(1);
  });

  it("closes the form on Cancel", async () => {
    stub(() => Response.json({}, { status: 500 }));
    const form = await openImport();
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: "Import a list as a new cube" })).toBeNull();
  });
});
