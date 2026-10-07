import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

async function request(url: string, manual = false, sourceDir = "") {
  const originalFetch = globalThis.fetch;
  const originalManual = process.env.E2E_MANUAL;
  const originalSource = process.env.E2E_CARD_IMAGE_SOURCE_DIR;
  process.env.E2E_MANUAL = manual ? "1" : "0";
  process.env.E2E_CARD_IMAGE_SOURCE_DIR = sourceDir;
  globalThis.fetch = async () => new Response("network image", { headers: { "content-type": "image/jpeg" } });
  try {
    // Reload the preload so it captures this test's underlying fetch and mode.
    await import(`../stack/fetch-stub.mjs?test=${requestId++}`);
    const response = await fetch(url);
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalManual === undefined) delete process.env.E2E_MANUAL;
    else process.env.E2E_MANUAL = originalManual;
    if (originalSource === undefined) delete process.env.E2E_CARD_IMAGE_SOURCE_DIR;
    else process.env.E2E_CARD_IMAGE_SOURCE_DIR = originalSource;
  }
}
let requestId = 0;

test("ordinary e2e keeps the tiny JPEG", async () => {
  const response = await request("https://images.ygoprodeck.com/images/cards/69247929.jpg");
  assert.equal(response.status, 200);
  assert.deepEqual([...response.body.subarray(0, 2)], [0xff, 0xd8]);
  assert.ok(response.body.length < 1000);
});

test("manual images read the full and small real cache without writing into it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-card-source-"));
  try {
    writeFileSync(join(dir, "69247929.jpg"), "full card image");
    writeFileSync(join(dir, "69247929-small.jpg"), "small card image");
    assert.equal((await request("https://images.ygoprodeck.com/images/cards/69247929.jpg", true, dir)).body.toString(), "full card image");
    assert.equal((await request("https://images.ygoprodeck.com/images/cards_small/69247929.jpg", true, dir)).body.toString(), "small card image");
    assert.deepEqual(readdirSync(dir).sort(), ["69247929-small.jpg", "69247929.jpg"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("manual images use YGOPRODeck when the source cache has no image", async () => {
  assert.equal((await request("https://images.ygoprodeck.com/images/cards/69247929.jpg", true)).body.toString(), "network image");
});

test("Discord membership requests pass through in ordinary and manual mode", async () => {
  for (const manual of [false, true]) {
    for (const url of ["https://discord.com/api/v10/guilds/123/members/456", "https://discord.com/api/v10/guilds/123/members/789", "https://discord.com/api/v10/guilds/789/members/456"]) {
      const response = await request(url, manual);
      assert.equal(response.status, 200);
      assert.equal(response.body.toString(), "network image");
    }
  }
});

test("set synchronization is offline in an isolated worker", async () => {
  assert.deepEqual(JSON.parse((await request("https://db.ygoprodeck.com/api/v7/cardsets.php")).body.toString()),
    [{set_name:"Metal Raiders",set_code:"MRD",num_of_cards:144,tcg_date:"2002-06-26"}]);
});
