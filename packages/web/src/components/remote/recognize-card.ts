export type RecognizedCard = { id: number; name: string };

/** Frames stay in this browser. Only OCR text / public passcodes reach the catalog. */
export async function recognizeLocalCard(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<RecognizedCard[]> {
  signal.throwIfAborted();
  const frame = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not capture the frame")), "image/png"));
  signal.throwIfAborted();
  const worker = new Worker("/remote-ocr-worker.js");
  let abort!: () => void;
  try {
    const text = await new Promise<string>((resolve, reject) => {
      abort = () => reject(new Error("Recognition cancelled or timed out. Try again."));
      signal.addEventListener("abort", abort, { once: true });
      worker.onerror = () => reject(new Error("OCR could not start. Check network access and try again."));
      worker.onmessage = event => typeof event.data.text === "string" ? resolve(event.data.text) : reject(new Error(event.data.error ?? "Recognition failed"));
      worker.postMessage({ image: frame });
    });
    const ids = [...new Set((text.match(/\b\d{8}\b/g) ?? []).map(Number))].filter(id => id > 0).slice(0, 5);
    async function resolve(body: unknown): Promise<RecognizedCard[]> {
      const response = await fetch("/api/cards/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Card lookup unavailable");
      return (data.cards ?? []).map((card: RecognizedCard) => ({ id: card.id, name: card.name })).slice(0, 5);
    }
    if (ids.length) { const cards = await resolve({ lookupIds: ids }); if (cards.length) return cards; }
    const names = text.split(/\r?\n/).map(line => line.replace(/[^\p{L}\p{N}' -]/gu, "").trim()).filter(line => /[a-z]{3}/i.test(line) && line.length <= 200).slice(0, 3);
    for (const name of names) {
      const cards = await resolve({ fuzzyName: name, includeExtra: true });
      if (cards.length) return cards;
    }
    return [];
  } finally {
    signal.removeEventListener("abort", abort);
    // Terminating the owned host also terminates its child OCR workers, even mid-init.
    worker.terminate();
  }
}
