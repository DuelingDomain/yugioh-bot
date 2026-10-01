import { config } from "dotenv";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@yugidraft/shared/db";
import { createBroadcaster, httpTransport } from "@yugidraft/shared/notify";
import { loadCardDatabase } from "./cards.js";
import { createDuelHost } from "./host.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
config({ path: resolve(root, ".env") });
const dataDirectory = resolve(root, process.env.DUEL_DATA_DIR ?? "data/duel-engine");
const db = openDatabase(resolve(root, process.env.DATABASE_PATH ?? "data/bot.sqlite"));
const cards = loadCardDatabase(dataDirectory);
const wsTransport = httpTransport({
  url: process.env.WS_INTERNAL_URL ?? "",
  secret: process.env.WS_INTERNAL_SECRET ?? "",
});
// The broadcaster logs a warning when the ws server rejects or cannot be reached; it never throws.
const broadcaster = createBroadcaster(wsTransport);
const archiveAfterMs = Number(process.env.DUEL_ARCHIVE_AFTER_MS);
const idleWorkerMs = Number(process.env.DUEL_IDLE_WORKER_MS);
const botStepMs = Number(process.env.DUEL_BOT_STEP_MS ?? 900);
const host = createDuelHost({
  db,
  dataDirectory,
  secret: process.env.DUEL_INTERNAL_SECRET ?? "",
  searchCards: (query) => cards.search(query),
  onChange: async (slug, guildId) => {
    await wsTransport.post("/internal/duel/changed", JSON.stringify({ slug, guildId }));
  },
  notifyTournament: async ({ kind, slug }) => {
    await broadcaster.tournament({ kind, slug });
  },
  archiveAfterMs: Number.isFinite(archiveAfterMs) ? archiveAfterMs : undefined,
  idleWorkerMs: Number.isFinite(idleWorkerMs) ? idleWorkerMs : undefined,
  // Base pause before a practice bot summon/set/activation; other actions scale from it. 0 answers instantly.
  botStepDelayMs: Number.isFinite(botStepMs) && botStepMs > 0 ? botStepMs : 0,
});
const server = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 64 * 1024) {
        response.writeHead(413, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Request too large" }));
        return;
      }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const method = request.method ?? "GET";
    const result = await host.handle(new Request(`http://localhost${request.url ?? "/"}`, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
    }));
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error("[duel] Request failed", error);
    if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Duel service request failed" }));
  }
});
const port = Number(process.env.DUEL_INTERNAL_PORT ?? 4003);
const bind = process.env.DUEL_INTERNAL_HOST ?? "127.0.0.1";
server.listen(port, bind, () => console.log(`[duel] Private server listening on http://${bind}:${port}`));

async function shutdown() {
  server.close();
  await host.close();
  cards.close();
  db.close();
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
