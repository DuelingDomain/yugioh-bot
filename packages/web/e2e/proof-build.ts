import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";

/** Bundle shipped duel components into a standalone file:// page, with no web server or auth. */
export async function buildProofPage(artifacts: string, entry: string, title: string, data: unknown) {
  const root = fileURLToPath(new URL(".", import.meta.url));
  await mkdir(artifacts, { recursive: true });
  await build({
    configFile: false, root, cacheDir: resolve(artifacts, ".vite"), base: "./",
    esbuild: { jsx: "automatic" }, css: { postcss: { plugins: [] } },
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) }, dedupe: ["react", "react-dom"] },
    build: {
      outDir: resolve(artifacts, "bundle"), emptyOutDir: true,
      rollupOptions: {
        input: resolve(root, entry),
        output: { entryFileNames: "browser.js", assetFileNames: "browser.[ext]" },
      },
    },
    plugins: [{
      name: "proof-test-only-fonts", enforce: "pre",
      resolveId(id) { if (id === "next/font/google") return "\0test-fonts"; },
      load(id) {
        if (id === "\0test-fonts") return `const font = () => ({className: '', variable: '', style: {}});
          export {font as Oxanium, font as Newsreader, font as Sofia_Sans_Semi_Condensed, font as Sofia_Sans_Extra_Condensed};`;
      },
    }, react()],
  });
  // Absolute public URLs do not resolve in file:// pages. Keep the shipped card backs local.
  const cssPath = resolve(artifacts, "bundle/browser.css");
  const css = await readFile(cssPath, "utf8");
  await writeFile(cssPath, css.replace(/\/duel\/(card-back-(?:main|extra)-hd\.webp)/g, "./$1"));
  for (const name of ["card-back-main-hd.webp", "card-back-extra-hd.webp"]) {
    await copyFile(fileURLToPath(new URL(`../public/duel/${name}`, import.meta.url)), resolve(artifacts, "bundle", name));
  }
  const html = resolve(artifacts, "bundle/index.html");
  await writeFile(html, `<!doctype html><html><head><title>${title}</title>
    <link rel="stylesheet" href="./browser.css"><style>
      * {box-sizing:border-box} body {margin:0;padding:20px;background:#111218;color:#efe7d5;font:16px Arial}
      h1 {margin:0 0 8px;font-size:24px} p {margin:0 0 12px} button {font:inherit}
    </style></head><body><div id="root"></div>
    <script type="application/json" id="engine-view">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
    <script type="module" src="./browser.js"></script></body></html>`);
  return html;
}
