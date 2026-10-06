// Preloaded into the web and worker (NODE_OPTIONS=--import). It answers the
// external calls used by the isolated stack, so tests need no Discord or internet:
//  - Discord "get guild member" for the fake E2E players -> 200, anyone else -> 404
//  - worker card-set metadata -> offline Metal Raiders fixture
//  - card images from images.ygoprodeck.com -> a 1x1 JPEG
// Everything else goes to the real fetch. Production code is not changed.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const realFetch = globalThis.fetch;
const manualMode = process.env.E2E_MANUAL === "1";
const sourceDir = process.env.E2E_CARD_IMAGE_SOURCE_DIR;
const members = new Set((process.env.E2E_STUB_MEMBER_IDS ?? "").split(",").filter(Boolean));
const guildId = process.env.E2E_STUB_GUILD_ID ?? "";
const JPEG = Buffer.from(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAQT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCZAKQ//9k=",
  "base64",
);

globalThis.fetch = async function e2eFetch(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const member = /^https:\/\/discord\.com\/api\/v\d+\/guilds\/(\d+)\/members\/(\d+)/.exec(url);
  if (member) {
    const ok = member[1] === guildId && members.has(member[2]);
    return new Response(ok ? JSON.stringify({ user: { id: member[2] } }) : JSON.stringify({ message: "Unknown Member" }), {
      status: ok ? 200 : 404,
      headers: { "content-type": "application/json" },
    });
  }
  if (new URL(url).origin === "https://db.ygoprodeck.com" && new URL(url).pathname === "/api/v7/cardsets.php") {
    return Response.json([{set_name:"Metal Raiders",set_code:"MRD",num_of_cards:144,tcg_date:"2002-06-26"}]);
  }
  if (url.startsWith("https://images.ygoprodeck.com/")) {
    if (manualMode) {
      // The web writes downloads into its own .stack cache. This shared cache is only read.
      const image = /^\/images\/(cards|cards_small)\/(\d{1,10})\.jpg$/.exec(new URL(url).pathname);
      if (sourceDir && image) {
        const [, size, code] = image;
        const names = size === "cards_small"
          ? [`${code}-small.jpg`, `${code}.png`, `${code}.jpg`, `${code}-full.png`]
          : [`${code}.jpg`, `${code}-full.png`];
        for (const name of names) {
          try {
            const cached = await readFile(join(sourceDir, name));
            return new Response(cached, { status: 200, headers: { "content-type": name.endsWith(".png") ? "image/png" : "image/jpeg" } });
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
      }
      return realFetch(input, init);
    }
    return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
  }
  return realFetch(input, init);
};
