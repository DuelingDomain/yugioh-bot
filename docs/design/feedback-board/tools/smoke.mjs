// Loads the assembled page in jsdom, reports script errors, duplicate ids, and clicks every button once.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(new URL("../../../../package.json", import.meta.url));
const { JSDOM, VirtualConsole } = require("jsdom");
const html = readFileSync(process.argv[2], "utf8");
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e.message || e)));
vc.on("error", (e) => errors.push("console.error: " + e));
const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { runScripts: "dangerously", virtualConsole: vc, pretendToBeVisual: true });
const { window } = dom; const doc = window.document;
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
await new Promise((r) => setTimeout(r, 300));
const ids = {}; for (const el of doc.querySelectorAll("[id]")) ids[el.id] = (ids[el.id] || 0) + 1;
const dups = Object.entries(ids).filter(([, n]) => n > 1);
let clicked = 0;
for (const b of [...doc.querySelectorAll("button")]) { try { b.click(); clicked++; } catch (e) { errors.push("click: " + e.message); } }
await new Promise((r) => setTimeout(r, 300));
const hrefs = [...doc.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href").slice(1)).filter((h) => h && !ids[h]);
console.log(`sections: ${[...doc.querySelectorAll("main > section")].map((s) => s.id).join(", ")}`);
console.log(`buttons clicked: ${clicked}, duplicate ids: ${dups.length ? dups.map((d) => d.join("x")).join(", ") : "none"}, dead #links: ${hrefs.length ? [...new Set(hrefs)].join(", ") : "none"}`);
console.log(errors.length ? errors.join("\n") : "no script errors");
window.close();
