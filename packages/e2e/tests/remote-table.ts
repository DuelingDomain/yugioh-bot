import { expect, type APIRequestContext } from "@playwright/test";

/** Alice (seat 0, host) and Bob (seat 1) sit at a started 1v1 table, each with the seeded legal deck. */
export async function startTwoPlayerTable(alice: APIRequestContext, bob: APIRequestContext) {
  const created = await alice.post("/api/remote", { data: { gameId: "ygo", seatCount: 2 } });
  expect(created.status(), await created.text()).toBe(201);
  const slug = (await created.json()).slug as string;
  expect((await bob.post(`/api/remote/${slug}/seat`, { data: { seat: 1 } })).ok()).toBe(true);
  for (const api of [alice, bob]) {
    const decks = (await (await api.get("/api/decks")).json()).decks as { id: number }[];
    expect(decks.length).toBeGreaterThan(0);
    const picked = await api.post(`/api/remote/${slug}/deck`, { data: { savedDeckId: decks[0]!.id } });
    expect(picked.ok(), await picked.text()).toBe(true);
    const ready = await api.post(`/api/remote/${slug}/ready`, { data: { ready: true } });
    expect(ready.ok(), await ready.text()).toBe(true);
  }
  const started = await alice.post(`/api/remote/${slug}/start`, { data: {} });
  expect(started.ok(), await started.text()).toBe(true);
  return slug;
}
