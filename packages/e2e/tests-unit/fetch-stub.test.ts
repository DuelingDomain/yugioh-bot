import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function request(url: string, manual = false, sourceDir = "") {
  const script = `
    globalThis.fetch = async () => new Response('network image', { headers: { 'content-type': 'image/jpeg' } });
    await import('./stack/fetch-stub.mjs');
    const response = await fetch(${JSON.stringify(url)});
    console.log(JSON.stringify({ status: response.status, body: Buffer.from(await response.arrayBuffer()).toString('base64') }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: new URL("../", import.meta.url), encoding: "utf8",
    env: { ...process.env, E2E_MANUAL: manual ? "1" : "0", E2E_CARD_IMAGE_SOURCE_DIR: sourceDir, E2E_STUB_GUILD_ID: "123", E2E_STUB_MEMBER_IDS: "456" },
  });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  return { status: response.status as number, body: Buffer.from(response.body, "base64") };
}

test("ordinary e2e keeps the tiny JPEG", () => {
  const response = request("https://images.ygoprodeck.com/images/cards/69247929.jpg");
  assert.equal(response.status, 200);
  assert.deepEqual([...response.body.subarray(0, 2)], [0xff, 0xd8]);
  assert.ok(response.body.length < 1000);
});

test("manual images read the full and small real cache without writing into it", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-card-source-"));
  try {
    writeFileSync(join(dir, "69247929.jpg"), "full card image");
    writeFileSync(join(dir, "69247929-small.jpg"), "small card image");
    assert.equal(request("https://images.ygoprodeck.com/images/cards/69247929.jpg", true, dir).body.toString(), "full card image");
    assert.equal(request("https://images.ygoprodeck.com/images/cards_small/69247929.jpg", true, dir).body.toString(), "small card image");
    assert.deepEqual(readdirSync(dir).sort(), ["69247929-small.jpg", "69247929.jpg"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("manual images use YGOPRODeck when the source cache has no image", () => {
  assert.equal(request("https://images.ygoprodeck.com/images/cards/69247929.jpg", true).body.toString(), "network image");
});

test("manual mode still stubs Discord membership for exactly the fake players", () => {
  const member = request("https://discord.com/api/v10/guilds/123/members/456", true);
  assert.equal(member.status, 200);
  assert.deepEqual(JSON.parse(member.body.toString()), { user: { id: "456" } });
  assert.equal(request("https://discord.com/api/v10/guilds/123/members/789", true).status, 404);
  assert.equal(request("https://discord.com/api/v10/guilds/789/members/456", true).status, 404);
});

test("set synchronization is offline in an isolated worker", () => {
  assert.deepEqual(JSON.parse(request("https://db.ygoprodeck.com/api/v7/cardsets.php").body.toString()),
    [{set_name:"Metal Raiders",set_code:"MRD",num_of_cards:144,tcg_date:"2002-06-26"}]);
});
