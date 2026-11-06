// Checks one approach fragment for the rules that keep three fragments from breaking each other on one page.
// Usage: node check-fragment.mjs <a|b|c>   (reads ../approach-<x>.html). Exit 1 on errors.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const x = (process.argv[2] || "").toLowerCase();
if (!/^[abc]$/.test(x)) { console.error("usage: node check-fragment.mjs <a|b|c>"); process.exit(2); }
const path = join(dirname(fileURLToPath(import.meta.url)), "..", `approach-${x}.html`);
const src = readFileSync(path, "utf8");
const errors = [], warns = [];
const err = (m) => errors.push(m), warn = (m) => warns.push(m);
const lineOf = (i) => src.slice(0, i).split("\n").length;
const P = `.ap-${x}`;

if (!src.trimStart().startsWith(`<section class="ws-approach ap-${x}" id="approach-${x}"`)) err(`must start with <section class="ws-approach ap-${x}" id="approach-${x}" ...>`);
if (!/<\/section>\s*$/.test(src)) err("must end with </section>");
if (!/<!--NAME:[^>]{2,40}-->/.test(src)) err("needs a <!--NAME:Your approach name--> comment right after the opening <section> (used in the jump bar)");

// CSS scoping
const styles = [...src.matchAll(/<style>([\s\S]*?)<\/style>/g)];
for (const s of styles) {
  const css = s[1].replace(/\/\*[\s\S]*?\*\//g, "");
  if (/:root|(^|[\s,}])(html|body)\b/.test(css)) err("CSS touches :root, html or body");
  if (/@import|@font-face/.test(css)) err("CSS uses @import or @font-face (fonts are loaded by the page)");
  for (const k of css.matchAll(/@keyframes\s+([\w-]+)/g)) if (!k[1].startsWith(`ap${x}-`)) err(`@keyframes ${k[1]} must be named ap${x}-...`);
  // strip keyframes bodies, then walk selectors
  const flat = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "").replace(/@(media|supports|container)[^{]*\{/g, "");
  for (const m of flat.matchAll(/([^{}@;]+)\{/g)) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith("@")) continue;
    for (const part of sel.split(",")) {
      const p = part.trim();
      if (!p) continue;
      if (!(p === P || p.startsWith(P + " ") || p.startsWith(P + ".") || p.startsWith(P + ":") || p.startsWith(P + ">") || p.startsWith(P + "["))) err(`CSS selector not scoped to ${P}: "${p.slice(0, 80)}"`);
    }
  }
}
if (styles.length > 1) warn("more than one <style> block; one is easier to review");

// Markup rules
const body = src.replace(/<style>[\s\S]*?<\/style>/g, (m) => " ".repeat(m.length)).replace(/<script>[\s\S]*?<\/script>/g, (m) => " ".repeat(m.length));
if (/<link\b|<script\s+src|<iframe|<object|<embed/i.test(src)) err("no <link>, external <script src>, iframe, object or embed");
for (const m of src.matchAll(/\b(?:src|href)="(https?:[^"]+)"/g)) if (!m[1].startsWith("https://claude.ai/artifact/Y2oAJAi4vJWXgwVVGQrrMD")) err(`external URL not allowed: ${m[1]}`);
for (const m of body.matchAll(/\sid="([^"]+)"/g)) if (!(m[1] === `approach-${x}` || m[1].startsWith(`ap${x}-`))) err(`line ${lineOf(m.index)}: id "${m[1]}" must start with ap${x}-`);
for (const m of body.matchAll(/\s(on[a-z]+)=/gi)) err(`line ${lineOf(m.index)}: inline event attribute ${m[1]}; attach handlers in the fragment script`);
if (/\p{Extended_Pictographic}/u.test(body.replace(/<[^>]+>/g, " "))) err("emoji in content");
if (/yu-?gi-?oh|duel monsters|konami/i.test(src)) err("trademarked game name");
if (/lorem ipsum/i.test(src)) err("lorem ipsum");
for (const m of body.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(m[0])) warn(`line ${lineOf(m.index)}: <img> without alt`);
for (const m of body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
  const t = m[2].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").trim();
  if (!t && !/aria-label="/.test(m[1])) err(`line ${lineOf(m.index)}: icon-only <button> needs aria-label`);
  if (!/\stype="/.test(m[1])) warn(`line ${lineOf(m.index)}: <button> without type="button"`);
}
for (const m of body.matchAll(/<(input|textarea|select)\b([^>]*)>/g)) {
  const id = /\sid="([^"]+)"/.exec(m[2]);
  if (!/aria-label="/.test(m[2]) && !(id && body.includes(`for="${id[1]}"`))) warn(`line ${lineOf(m.index)}: <${m[1]}> has no label`);
}

// Tag balance
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const stack = [];
for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g)) {
  const [, close, raw, attrs, self] = m; const name = raw.toLowerCase();
  for (const a of attrs.matchAll(/\s([^\s=>\/]+)=([^"'\s>][^\s>]*)/g)) err(`line ${lineOf(m.index)}: unquoted attribute ${a[1]}`);
  if (VOID.has(name)) continue;
  if (close) {
    const top = stack.pop();
    if (!top) err(`line ${lineOf(m.index)}: stray </${name}>`);
    else if (top.name !== name) { err(`line ${lineOf(m.index)}: </${name}> closes <${top.name}> from line ${top.at}`); stack.push(top); const i = stack.map((s) => s.name).lastIndexOf(name); if (i >= 0) stack.length = i; }
  } else if (!self) stack.push({ name, at: lineOf(m.index) });
}
for (const s of stack) err(`<${s.name}> from line ${s.at} never closed`);

// Script: one IIFE, scoped to the section, parses
const scripts = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length > 1) err("at most one <script> block");
for (const s of scripts) {
  const js = s[1].trim();
  if (!/^\(\s*\(\s*\)\s*=>\s*\{|^\(function\s*\(\s*\)\s*\{/.test(js)) err("script must be a single IIFE: (() => { ... })();");
  if (!js.includes(`getElementById("approach-${x}")`) && !js.includes(`getElementById('approach-${x}')`)) err(`script must start from document.getElementById("approach-${x}") and query inside it`);
  if (/document\.(querySelector|querySelectorAll|getElementsBy)/.test(js)) err("script queries the whole document; query inside the section root");
  if (/\b(window\.\w+\s*=|localStorage|fetch\(|XMLHttpRequest|alert\(|confirm\(|prompt\()/.test(js)) err("script sets globals, uses storage/network or dialogs");
  if (/addEventListener\(\s*["']key/.test(js) && /\b(document|window)\.addEventListener/.test(js)) err("global key handler");
  try { new vm.Script(js); } catch (e) { err(`script does not parse: ${e.message}`); }
}

console.log(`${path}: ${errors.length} error(s), ${warns.length} warning(s), ${(src.length / 1024).toFixed(0)} KB`);
for (const e of errors) console.log("  ERROR " + e);
for (const w of warns) console.log("  warn  " + w);
process.exit(errors.length ? 1 : 0);
