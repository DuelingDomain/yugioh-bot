// Inlines the approach fragments (and the compare/questions blocks once they exist) into shell.html.
// Usage: node assemble.mjs [out.html]   (default ../workshop.html). Missing fragments leave a visible placeholder.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? args.splice(onlyAt, 2)[1] : null; // --only b : a preview with just that chapter
const focusAt = args.indexOf("--focus");
const focus = focusAt >= 0 ? args.splice(focusAt, 2)[1] : null; // --focus apb-s4 : show only that element (for headless screenshots)
const out = args[0] || join(dir, "workshop.html");
let html = readFileSync(join(dir, "shell.html"), "utf8");
const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8").trim() : null);

html = html.replace("<!--COMPARE-->", () => (only ? "" : read("compare.html") ?? ""));
html = html.replace("<!--QUESTIONS-->", () => (only ? "" : read("questions.html") ?? ""));
for (const x of ["a", "b", "c"]) {
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
