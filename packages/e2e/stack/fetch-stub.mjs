// Preloaded into the WEB server only (NODE_OPTIONS=--import). It answers the two
// outside calls the duel flows make, so the test needs no Discord and no internet:
//  - Discord "get guild member" for the fake E2E players -> 200, anyone else -> 404
//  - card images from images.ygoprodeck.com -> a 1x1 JPEG
// Everything else goes to the real fetch. Production code is not changed.
const realFetch = globalThis.fetch;
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
  if (url.startsWith("https://images.ygoprodeck.com/")) {
    return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
  }
  return realFetch(input, init);
};
