// Prints the visible text of a fragment (style/script stripped) plus aria/title/placeholder attributes and script string literals.
import { readFileSync } from "node:fs";
const src = readFileSync(process.argv[2], "utf8");
const body = src.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script>[\s\S]*?<\/script>/g, "");
const text = body.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/&middot;/g, "·").replace(/&nbsp;/g, " ").split("\n").map((s) => s.trim()).filter(Boolean);
const attrs = [...body.matchAll(/\s(?:aria-label|title|placeholder|alt|data-[\w-]+)="([^"]{3,})"/g)].map((m) => m[1]);
const js = (src.match(/<script>([\s\S]*?)<\/script>/) || ["", ""])[1];
const lits = [...js.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.){6,})\1/g)].map((m) => m[2]).filter((s) => /[a-z] [a-z]/i.test(s));
console.log([...new Set(text)].join(" | "));
console.log("\n--- attrs ---\n" + [...new Set(attrs)].join(" | "));
console.log("\n--- script strings ---\n" + [...new Set(lits)].join(" | "));
