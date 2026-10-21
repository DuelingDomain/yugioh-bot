/** Targeted browser integration: real watch UI, API-edge fixtures, socket invalidations. No engine or app services. */
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { readFile, rm } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDuelSettings, seatCountFor, type DuelFormat } from "@yugidraft/shared/duels";
const here = fileURLToPath(new URL(".", import.meta.url));
const out = resolve(here, "../.next/admin-spectate-proof");
const stubs: Record<string, string> = {
  "next/link": `import React from 'react'; export default function Link({prefetch,...props}) { return React.createElement('a',props); }`,
  "next/image": `import React from 'react'; export default function Image({fill,priority,unoptimized,loader,...props}) { return React.createElement('img',props); }`,
  "next/navigation": `export const usePathname=()=>location.pathname; export const useSearchParams=()=>new URLSearchParams(location.search); export const useRouter=()=>({push(){},replace(){},prefetch(){}});`,
  "next/font/google": `const f=()=>({className:'font',variable:'font',style:{fontFamily:'sans-serif'}}); export {f as Oxanium,f as Sofia_Sans_Extra_Condensed,f as Sofia_Sans_Semi_Condensed,f as Russo_One,f as Chakra_Petch,f as Barlow_Semi_Condensed,f as Barlow_Condensed,f as Newsreader};`,
  "socket.io-client": `export function io(){const callbacks={}; window.__adminChange=()=>Object.entries(callbacks).forEach(([e,f])=>{if(e.includes('changed')||e.includes('resync'))f({});}); return {connected:true,on(e,f){callbacks[e]=f;if(e==='connect')queueMicrotask(f);return this;},timeout(){return this;},emitWithAck:async()=>({ok:true}),disconnect(){}};}`,
};
await build({ configFile: false, root: here, base: "/bundle/", logLevel: "warn", css: { postcss: { plugins: [] } },
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_WS_URL": '""' },
  resolve: { alias: { "@": resolve(here, "../src") }, dedupe: ["react", "react-dom", "swr"] },
  build: { outDir: out, emptyOutDir: true, minify: false, rollupOptions: { input: resolve(here, "admin-spectate-browser.tsx"), output: { entryFileNames: "browser.js", assetFileNames: "[name].[ext]" } } },
  plugins: [{ name: "edge-stubs", enforce: "pre", resolveId(id) { if (id in stubs) return `\0stub:${id}`; }, load(id) { if (id.startsWith("\0stub:")) return stubs[id.slice(6)]; } }, react()],
});
const browser = await chromium.launch({ headless: true });
const errors: string[] = []; const mutations: string[] = [];
try {
  for (const format of ["1v1", "ffa3", "ffa4", "tag", "draft"] as const) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    let revision = 1, denied = false;
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET") mutations.push(route.request().url());
      if (url.pathname.startsWith("/bundle/")) {
        const path = resolve(out, url.pathname.slice(8));
        return route.fulfill({ body: await readFile(path), contentType: extname(path) === ".js" ? "text/javascript" : "text/css" });
      }
      if (url.pathname.endsWith("/connection")) return route.fulfill({ json: { token: "fixture", expiresAt: Date.now() + 60_000 } });
      if (url.pathname.includes("/api/admin/")) {
        if (denied) return route.fulfill({ status: 404, json: { error: "Not found" } });
        const value = url.searchParams.get("seat"); const seat = value === "public" ? null : Number(value);
        if (format === "draft") {
          const pov = seat ?? 12; const card = { id: pov, passcode: 100 + pov, name: `Pack for ${pov} revision ${revision}` };
          return route.fulfill({ json: { readOnly: true, pov, picks: [], deck: null, draft: { name: "Private draft", status: "active", config: { mode: "theme" },
            seats: [12, 13].map(id => ({ playerId: id, displayName: `Player ${id}`, isCurrentPlayer: id === pov, hasPicked: false })),
            currentPack: [card], myPool: [], packRound: 1, pickStep: revision, timerSeconds: 30, isMyTurn: true } } });
        }
        const seats = Array.from({ length: seatCountFor(format as DuelFormat) }, (_, s) => ({ seat: s, playerId: s + 1, displayName: `Player ${s}`, ready: true, isBot: false }));
        return route.fulfill({ json: { readOnly: true, pov: seat, room: { role: "spectator", mySeat: seat, myDeck: null, clock: null, metadataOnly: false,
          session: { id: 1, slug: "duel", name: "Private duel", guildId: "g", format, mode: "normal", masterRule: 5, status: "active", settings: defaultDuelSettings("normal"), seats, kind: "play", createdAt: "2026-10-21T00:00:00Z" },
          engine: { revision, format, turn: revision, turnSeat: 0, phase: "main1", prioritySeat: 0, chain: [], events: [], log: [], result: null,
            prompt: seat === null ? null : { id: "p", seat, kind: "choice", title: `Private prompt ${seat} revision ${revision}`, options: [{ id: "end", label: "End turn" }] },
            seats: seats.map(s => ({ seat: s.seat, lp: 8000, hand: [{ controller: s.seat, location: 2, sequence: 0, position: 8, ...(seat === s.seat ? { code: 100 + s.seat, name: `Private hand ${s.seat}` } : {}) }], extra: [], extraCount: 0, deckCount: 35, monsters: [], spells: [], graveyard: [], banished: [] })) } } } });
      }
      if (url.pathname.startsWith("/api/cards/")) return route.fulfill({ status: 204 });
      return route.fulfill({ contentType: "text/html", body: '<html><head><link rel="stylesheet" href="/bundle/admin-spectate-browser.css"></head><body style="background:#101019;color:white"><div id="root"></div><script type="module" src="/bundle/browser.js"></script></body></html>' });
    });
    await page.goto(`http://spectate.test/admin/watch/${format === "draft" ? "draft" : "duel"}/test`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(format === "draft" ? "Private draft" : "Private duel");
    if (format === "draft") {
      await expect(page.getByText("Pack for 12 revision 1")).toBeVisible();
      await page.getByLabel("Point of view").selectOption("13"); await expect(page.getByText("Pack for 13 revision 1")).toBeVisible();
      await expect(page.getByText("Pack for 12 revision 1")).toHaveCount(0);
      revision++; await page.evaluate(() => (window as any).__adminChange()); await expect(page.getByText("Pack for 13 revision 2")).toBeVisible();
    } else {
      await expect(page.getByRole("region", { name: "Player prompt" })).toHaveCount(0);
      for (let seat = 0; seat < seatCountFor(format); seat++) {
        await page.getByLabel("Point of view").selectOption(String(seat));
        await expect(page.getByRole("heading", { name: `Private prompt ${seat} revision 1` })).toBeVisible();
        await expect(page.getByLabel(`Private hand ${seat}`, { exact: true }).first()).toBeVisible();
      }
      revision++; await page.evaluate(() => (window as any).__adminChange());
      await expect(page.getByRole("heading", { name: `Private prompt ${seatCountFor(format) - 1} revision 2` })).toBeVisible();
      await page.getByLabel("Point of view").selectOption("public"); await expect(page.getByRole("region", { name: "Player prompt" })).toHaveCount(0);
    }
    denied = true; await page.evaluate(() => (window as any).__adminChange()); await expect(page.getByRole("alert")).toContainText("no longer available");
    await expect(page.getByRole("heading", { name: "Current pack" })).toHaveCount(0);
    await page.close();
  }
  expect(errors).toEqual([]); expect(mutations).toEqual([]);
  console.log("PASS: 1v1, FFA3, FFA4, Tag and draft POV switching, live updates, revocation and zero mutations");
} finally { await browser.close(); await rm(out, { recursive: true, force: true }); }
