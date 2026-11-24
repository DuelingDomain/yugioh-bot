import { expect, it, vi } from "vitest";

vi.mock("@yugidraft/vision", async importOriginal => ({
  ...await importOriginal<typeof import("@yugidraft/vision")>(),
  createRecognizer: () => ({ prepare: async () => ({ backend: "wasm" }) }),
}));

it.each([
  { indexSha256: undefined, path: "related-cards.json", cache: "force-cache" },
  { indexSha256: "pinned-index", path: "related-cards.json?source=image", cache: "no-cache" },
])("loads $path with $cache", async ({ indexSha256, path, cache }) => {
  vi.resetModules();
  const fetchAsset = vi.fn(async (url: string, _init?: RequestInit) => url.includes("related-cards.json")
    ? new Response(null, { status: 404 }) : Response.json({ entries: [], indexSha256 }));
  vi.stubGlobal("fetch", fetchAsset);
  try {
    const { ownFieldResources } = await import("../src/components/remote/ui/recognizer");
    expect(await ownFieldResources(() => ({ decklist: [], seen: [] }))).not.toBeNull();
    expect(fetchAsset).toHaveBeenCalledWith(`/dev/vision-assets/${path}`, expect.objectContaining({ cache }));
  } finally {
    vi.unstubAllGlobals();
  }
});
