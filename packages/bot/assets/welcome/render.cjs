// A fresh worker per card bounds native resvg allocations independently of V8 GC.
const { parentPort, workerData } = require("node:worker_threads");
const { Resvg } = require("@resvg/resvg-js");
const { svg, fallbackSvg, avatar, fontFiles } = workerData;
let source = svg;
if (avatar) {
  let visible = false;
  try {
    // resvg silently ignores undecodable images. Probe alpha before using one.
    const probe = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><image href="${avatar}" width="256" height="256"/></svg>`,
      { font: { loadSystemFonts: false } }).render().pixels;
    for (let i = 3; i < probe.length; i += 4) {
      if (probe[i]) { visible = true; break; }
    }
  } catch { /* Use initials if decoding fails. */ }
  if (!visible) source = fallbackSvg;
}
const png = new Resvg(source, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Chakra Petch" } }).render().asPng();
const bytes = Uint8Array.from(png);
parentPort.postMessage(bytes, [bytes.buffer]);
