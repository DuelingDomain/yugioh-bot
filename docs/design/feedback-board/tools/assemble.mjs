// Inlines the approach fragments (and the compare/questions blocks once they exist) into shell.html.
// Usage: node assemble.mjs [out.html]   (default ../workshop.html). Missing fragments leave a visible placeholder.
//   --final : a page with only final.html (no A/B/C, compare or questions); default output ../final-workshop.html.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? args.splice(onlyAt, 2)[1] : null; // --only b : a preview with just that chapter
const finalAt = args.indexOf("--final");
const finalMode = finalAt >= 0; if (finalMode) args.splice(finalAt, 1); // --final : the final mock page only
const focusAt = args.indexOf("--focus");
const focus = focusAt >= 0 ? args.splice(focusAt, 2)[1] : null; // --focus apb-s4 : show only that element (for headless screenshots)
const out = args[0] || join(dir, finalMode ? "final-workshop.html" : "workshop.html");
let html = readFileSync(join(dir, "shell.html"), "utf8");
const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8").trim() : null);

if (finalMode) {
  const frag = read("final.html") ?? `<section class="ws-approach ap-f" id="approach-f"><p class="ws-p">final.html is still being written.</p></section>`;
  const name = (/<!--NAME:([^>]{2,40})-->/.exec(frag) || [])[1] || "Ideas: final";
  const swap = (re, to, what) => { if (!re.test(html)) throw new Error("shell.html changed: cannot find " + what); html = html.replace(re, () => to); };
  swap(/<title>[^<]*<\/title>/, "<title>Ideas: final mock</title>", "title");
  swap(/<header class="ws-wrap ws-hero">[\s\S]*?<\/header>/, `<header class="ws-wrap ws-hero">
  <p class="ws-kicker">Dueling Domain · design workshop · final · Oct 31, 2026</p>
  <h1>Ideas: the final mock</h1>
  <p class="ws-intro">Final mock for the build. The owner picked A, The Ladder, on Oct 31, 2026.</p>
</header>`, "hero");
  swap(/<div class="ws-jump">[\s\S]*?<\/div>\s*(?=<main)/, `<div class="ws-jump">
  <nav class="ws-wrap" aria-label="Jump to section"><a href="#approach-f"><b>F</b>${name.trim()}</a></nav>
</div>

`, "jump bar");
  swap(/<section class="ws-section" id="brief"[\s\S]*?<\/section>\s*/, "", "brief section");
  html = html.replace("<!--APPROACH-A-->", () => frag).replace(/<!--(?:APPROACH-[BC]|COMPARE|QUESTIONS)-->/g, "");
  swap(/<p>Sample data:[\s\S]*?<\/p>/, "<p>Sample data: every person is an invented handle and the vote counts are sample numbers for a small alpha. Mock today is Fri Oct 30, 2026. The shipped lines come from real merged pull requests on main.</p>", "footer");
}

if (!finalMode) html = html.replace("<!--COMPARE-->", () => (only ? "" : read("compare.html") ?? ""));
if (!finalMode) html = html.replace("<!--QUESTIONS-->", () => (only ? "" : read("questions.html") ?? ""));
for (const x of finalMode ? [] : ["a", "b", "c"]) {
  const frag = only && only !== x ? "" : read(`approach-${x}.html`);
  const name = frag && /<!--NAME:([^>]{2,40})-->/.exec(frag);
  html = html.replaceAll(`<!--NAME-${x.toUpperCase()}-->`, () => name ? name[1].trim() : `Approach ${x.toUpperCase()}`);
  html = html.replace(`<!--APPROACH-${x.toUpperCase()}-->`, () => frag ?? `<section class="ws-approach" id="approach-${x}"><p class="ws-p">Approach ${x.toUpperCase()} is still being written.</p></section>`);
}
if (focus) html += `\n<script>(() => { const el = document.getElementById(${JSON.stringify(focus)}); if (!el) return;
  for (const e of document.querySelectorAll(".ws-hero, .ws-jump, .ws-foot")) e.style.display = "none";
  for (let n = el; n && n.tagName !== "BODY"; n = n.parentElement) for (const c of n.parentElement.children) if (c !== n && !/^(STYLE|SCRIPT)$/.test(c.tagName)) c.style.display = "none";
})();</script>`;
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
