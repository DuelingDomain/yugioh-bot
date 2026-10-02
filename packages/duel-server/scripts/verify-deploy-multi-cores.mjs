// Runs in the built duel image, without opening a port or reading the application database.
// Add --smoke to start Standard and Domain FFA3, FFA4 and Tag games on the installed files.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { verifyEngineBundle } from "../dist/engine-bundle.js";
import { multiCoreAvailable } from "../dist/presets/index.js";
import { multiDomainCoreAvailable, multiStartProblem } from "../dist/multi-domain-guard.js";
import { createDuelHost } from "../dist/host.js";
import { createEngineGame } from "../dist/engine.js";

const dataDirectory = process.env.DUEL_DATA_DIR ?? "/app/data/duel-engine";
verifyEngineBundle(dataDirectory);
assert.equal(multiCoreAvailable(dataDirectory), true);
assert.equal(multiDomainCoreAvailable(dataDirectory), true);
for (const stem of ["ocgcore.multi", "ocgcore.multi-domain"]) {
  const bytes = readFileSync(join(dataDirectory, `${stem}.wasm`));
  assert.ok(WebAssembly.validate(bytes));
  const sha = createHash("sha256").update(bytes).digest("hex");
  assert.equal(readFileSync(join(dataDirectory, `${stem}.sha256`), "utf8").split(/\s/)[0], sha);
  console.log(`${stem}.wasm sha256 ${sha}`);
}

const db = new Database(":memory:");
migrate(db);
// This credential signs an in-process Request only; nothing listens on a socket.
const secret = "deploy-core-check";
const host = createDuelHost({ db, dataDirectory, secret, searchCards: () => [] });
try {
  const body = JSON.stringify({ op: "capabilities", guildId: "verify", playerId: 1 });
  const response = await host.handle(new Request("http://localhost/internal/duel", {
    method: "POST", body,
    headers: { "x-announce-signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` },
  }));
  assert.equal(response.status, 200);
  const capabilities = await response.json();
  assert.equal(capabilities.multiDomainCoreReady, true);
  console.log(`multiCoreAvailable=true multiDomainCoreReady=${capabilities.multiDomainCoreReady}`);
} finally {
  await host.close();
  db.close();
}

if (process.argv.includes("--smoke")) {
  const cards = new Database(join(dataDirectory, "cards.cdb"), { readonly: true });
  const monsters = cards.prepare("SELECT id FROM datas WHERE type = 17 AND alias = 0 AND (ot & 3) != 0 ORDER BY id").all();
  const spells = cards.prepare("SELECT id FROM datas WHERE type = 2 AND alias = 0 AND (ot & 3) != 0 ORDER BY id").all();
  cards.close();
  for (const mode of ["normal", "domain"]) {
    for (const [format, count] of [["ffa3", 3], ["ffa4", 4], ["tag", 4]]) {
      assert.equal(multiStartProblem(mode, format, dataDirectory), null);
      const decks = Array.from({ length: count }, (_, seat) => ({
        main: spells.slice(seat * 40, seat * 40 + 40).map(({ id }) => id), extra: [], side: [],
        ...(mode === "domain" ? { deckMaster: monsters[seat].id } : {}),
      }));
      const game = await createEngineGame({ mode, format, decks, dataDirectory, seed: ["5", "6", "7", "8"] });
      try {
        assert.equal(game.coreInfo().wasmFile, mode === "domain" ? "ocgcore.multi-domain.wasm" : "ocgcore.multi.wasm");
        const view = game.view(null);
        assert.equal(view.seats.length, count);
        if (mode === "domain") assert.ok(view.seats.every((seat) => seat.deckMaster?.inZone));
        console.log(`${mode} ${format}: started ${count} seats with ${game.coreInfo().wasmFile}`);
      } finally {
        game.close();
      }
    }
  }
}
