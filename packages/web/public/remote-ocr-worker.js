/* One owned host per scan. Its entire worker tree is disposable during startup too. */
const children = new Set();
const NativeWorker = self.Worker;
self.Worker = class extends NativeWorker {
  constructor(...args) { super(...args); children.add(this); }
  terminate() { children.delete(this); return super.terminate(); }
};
function fail() {
  for (const worker of children) worker.terminate();
  self.postMessage({ error: "OCR could not load or read the frame. Check network access and try again." });
  self.close();
}
self.addEventListener("error", event => { event.preventDefault(); fail(); });
self.onmessage = async event => {
  try {
    importScripts("https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js");
    // errorHandler also handles initialization failures before createWorker resolves.
    const worker = await Tesseract.createWorker("eng", 1, { errorHandler: fail });
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
    const { data } = await worker.recognize(event.data.image);
    await worker.terminate();
    self.postMessage({ text: data.text });
    self.close();
  } catch { fail(); }
};
