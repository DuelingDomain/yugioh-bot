"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { createRecognizer, yugioh, type IndexMeta, type RecognitionResult } from "@yugidraft/vision";
import { useVisionSource } from "./use-vision-source";
import styles from "./vision-lab.module.css";

// Correction interaction adapted from Duel Lens's popover/keys/search UI (Apache-2.0).
// Modified for React and a local exportable correction log; no extension/report service.
// Licence: packages/vision/src/licenses/duel-lens.LICENSE.
interface Correction { at: string; guessed?: string; chosen: string; tier: RecognitionResult['tier']; sharpness: number; }
type Backend = "auto" | "wasm";
type Recognizer = ReturnType<typeof createRecognizer>;
type CardEntry = IndexMeta["entries"][number];
interface Selection { point: { x: number; y: number }; left: number; top: number }
const STAGES = ["sharpness", "detect", "warp", "embed", "search", "total"] as const;

function thumbnail(cardId: string, entry?: CardEntry): string | undefined {
  if (cardId === yugioh.cardBack.cardId) return yugioh.cardBack.imageUrl;
  if (entry?.thumbnailUrl) return entry.thumbnailUrl;
  if (entry?.imageId && entry.imageId !== entry.passcode && entry.imageUrl) return entry.imageUrl;
  if (entry?.passcode) return `/api/cards/${entry.passcode}/image?size=small`;
  return entry?.imageUrl;
}

export function VisionLab() {
  const recognizerRef = useRef<{ backend: Backend; value: Recognizer } | null>(null);
  const runRef = useRef(0);
  const busyRef = useRef(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [backend, setBackend] = useState<Backend>("auto");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [cards, setCards] = useState<Map<string, CardEntry>>(() => new Map());
  const [query, setQuery] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [metadataError, setMetadataError] = useState(false);

  const disposeRecognizer = useCallback(() => {
    runRef.current += 1;
    busyRef.current = false;
    recognizerRef.current?.value.dispose();
    recognizerRef.current = null;
  }, []);

  const reset = useCallback(() => {
    disposeRecognizer();
    setBusy(false);
    setResult(null);
    setError(null);
    setSelection(null);
    setConfirmed(null);
    setQuery("");
  }, [disposeRecognizer]);
  const source = useVisionSource(reset);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(yugioh.metaUrl, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Card metadata is unavailable");
        const meta = await response.json() as IndexMeta;
        if (!Array.isArray(meta.entries)) throw new Error("Card metadata is invalid");
        if (!controller.signal.aborted) setCards(new Map(meta.entries.map(entry => [entry.cardId, entry])));
      })
      .catch(() => { if (!controller.signal.aborted) setMetadataError(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => disposeRecognizer, [disposeRecognizer]);

  const recognize = async (point = selection?.point ?? { x: 0.5, y: 0.5 }) => {
    if (busyRef.current || !source.source) return;
    busyRef.current = true;
    const run = ++runRef.current;
    setBusy(true);
    setError(null);
    let frames: ImageBitmap[] = [];
    try {
      frames = await source.snapshot();
      if (run !== runRef.current) return;
      if (!recognizerRef.current || recognizerRef.current.backend !== backend) {
        recognizerRef.current?.value.dispose();
        recognizerRef.current = { backend, value: createRecognizer({ profile: yugioh, backend }) };
      }
      // The worker takes ownership of these clones; the source keeps its originals.
      const next = await recognizerRef.current.value.recognize(frames, { clickPoint: point, k: 5 });
      if (run === runRef.current) { setResult(next); setConfirmed(null); setQuery(""); }
    } catch (cause) {
      if (run === runRef.current) setError(cause instanceof Error ? cause.message : "Recognition failed. Try again.");
    } finally {
      // Also covers errors before the worker accepts ownership. close() is safe on transferred bitmaps.
      for (const frame of frames) frame.close();
      if (run === runRef.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const recognizeAt = (event: MouseEvent<HTMLButtonElement>) => {
    const { width, height } = source.dimensions;
    if (!width || !height || busyRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    // object-fit: contain adds letterboxing. Map only the visible image to [0, 1].
    const scale = Math.min(rect.width / width, rect.height / height);
    const visibleWidth = width * scale;
    const visibleHeight = height * scale;
    const offsetX = (rect.width - visibleWidth) / 2;
    const offsetY = (rect.height - visibleHeight) / 2;
    const localX = event.detail === 0 ? rect.width / 2 : event.clientX - rect.left;
    const localY = event.detail === 0 ? rect.height / 2 : event.clientY - rect.top;
    const x = (localX - offsetX) / visibleWidth;
    const y = (localY - offsetY) / visibleHeight;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    const next = { point: { x, y }, left: localX / rect.width * 100, top: localY / rect.height * 100 };
    setSelection(next);
    void recognize(next.point);
  };

  const confirm = useCallback((cardId: string) => {
    if (!result || busy) return;
    setConfirmed(cardId);
    setCorrections(log => [...log, { at: new Date().toISOString(), guessed: result.candidates[0]?.cardId,
      chosen: cardId, tier: result.tier, sharpness: result.quality.sharpness }]);
  }, [result, busy]);
  useEffect(() => {
    const pick = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.matches("input,select,textarea,button") || event.target.isContentEditable)) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < 5 && result?.candidates[index]) { event.preventDefault(); confirm(result.candidates[index].cardId); }
    };
    window.addEventListener("keydown", pick);
    return () => window.removeEventListener("keydown", pick);
  }, [confirm, result]);
  const matches = query.trim().length >= 2 ? [...cards.values()].filter(card =>
    card.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) || String(card.passcode).includes(query.trim())).slice(0, 8) : [];
  const exportCorrections = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ game: yugioh.id, model: yugioh.embedding.id, corrections }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "vision-corrections.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const ready = source.source !== null && source.frameCount > 0 && !source.preparing;
  const activeError = error ?? source.error;

  return (
    <main className={styles.lab}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Developer tools · Yu-Gi-Oh!</span>
          <h1>Card vision lab</h1>
          <p>Click a card in the camera or a photo to inspect the five closest matches.</p>
        </div>
        <span className={styles.local}>Recognition runs in your browser</span>
      </header>

      <div className={styles.workspace}>
        <section className={styles.capture} aria-labelledby="capture-heading">
          <div className={styles.sectionHead}>
            <h2 id="capture-heading">Image source</h2>
            <span>{source.source === "camera" ? "Live camera" : source.source === "photo" ? "Uploaded photo" : "No source"}</span>
          </div>
          <div className={styles.controls}>
            <button className={styles.primary} type="button" onClick={() => { void source.startCamera(); }} disabled={source.preparing}>Start camera</button>
            <button type="button" onClick={() => uploadRef.current?.click()}>Upload photo</button>
            <button type="button" onClick={source.stop} disabled={!source.source && !source.preparing}>Stop</button>
            <input ref={uploadRef} type="file" accept="image/*" className={styles.fileInput} aria-label="Upload a card photo" onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void source.loadPhoto(file);
            }} />
          </div>

          <button type="button" className={styles.preview} onClick={recognizeAt} disabled={!ready || busy} aria-label="Recognize a card: click its center in the image, or press Enter to use the image center">
            <video ref={source.videoRef} autoPlay muted playsInline hidden={source.source !== "camera"} />
            {source.photoUrl ? <img src={source.photoUrl} alt="Uploaded card photo" /> : null}
            {!source.source ? <span className={styles.placeholder}>
              <span className={styles.cardOutline} aria-hidden="true" />
              <strong>{source.preparing ? "Preparing image…" : "Bring a card into view"}</strong>
              <span>{source.preparing ? "Your image will appear here." : "Start the camera or upload a photo."}</span>
            </span> : null}
            {selection && source.source ? <span className={styles.target} style={{ left: `${selection.left}%`, top: `${selection.top}%` }} aria-hidden="true" /> : null}
            {busy ? <span className={styles.working}>Recognizing…</span> : null}
          </button>

          <div className={styles.sourceInfo}>
            <span>{source.dimensions.width ? `${source.dimensions.width} × ${source.dimensions.height}` : "Full-resolution capture"}</span>
            <span>{source.source === "camera" ? `${source.frameCount}/6 buffered · 5 fps max · 1 second` : source.source === "photo" ? "1 photo frame" : "Camera permission required"}</span>
          </div>

          <div className={styles.runControls}>
            <label htmlFor="vision-backend">Compute
              <select id="vision-backend" value={backend} disabled={busy} onChange={event => {
                disposeRecognizer();
                setBackend(event.target.value as Backend);
              }}>
                <option value="auto">Auto · prefer WebGPU</option>
                <option value="wasm">WASM · CPU benchmark</option>
              </select>
            </label>
            <button type="button" className={styles.primary} disabled={!ready || busy} onClick={() => { void recognize(); }}>
              {busy ? "Recognizing…" : selection ? "Recognize selected card" : "Recognize center card"}
            </button>
          </div>
          <p className={styles.hint}>Keep the card steady and evenly lit. The first recognition loads the local models and card index.</p>
          {activeError ? <p className={styles.error} role="alert">{activeError}</p> : null}
        </section>

        <section className={styles.matches} aria-labelledby="matches-heading">
          <div className={styles.sectionHead}>
            <h2 id="matches-heading">Top 5 matches</h2>
            <span>{result ? (result.backend === "webgpu" ? "WebGPU" : "WASM") : "Awaiting recognition"}</span>
          </div>
          {metadataError ? <p className={styles.warning}>Card names and thumbnails are unavailable. Prepare the vision index, then reload.</p> : null}
          <div aria-live="polite" aria-busy={busy}>
            {result ? <p className={styles.tier} data-tier={result.tier}>{result.tier} <span>· pick a match or press 1–5 to confirm</span></p> : null}
            {result?.candidates.length ? <ol className={styles.candidates}>
              {result.candidates.slice(0, 5).map((candidate, index) => {
                const entry = cards.get(candidate.cardId);
                const image = thumbnail(candidate.cardId, entry);
                const name = entry?.name ?? (candidate.cardId === yugioh.cardBack.cardId ? "Card back" : candidate.cardId);
                return <li key={candidate.cardId} className={index === 0 ? styles.best : undefined}>
                  <button type="button" className={styles.pick} onClick={() => confirm(candidate.cardId)} disabled={busy} aria-label={`Confirm match ${index + 1}: ${name}`} aria-pressed={confirmed === candidate.cardId}>
                  <span className={styles.rank}>{index + 1}</span>
                  {image ? <img className={styles.thumbnail} src={image} alt={name} loading="lazy" /> : <span className={styles.missingArt} aria-hidden="true">?</span>}
                  <div className={styles.cardInfo}><strong>{name}</strong><span>{entry?.passcode ? String(entry.passcode).padStart(8, "0") : candidate.cardId}{entry?.frameClass ? ` · ${entry.frameClass}` : ""}</span></div>
                  <div className={styles.score}><strong>{candidate.score.toFixed(4)}</strong><span>similarity</span></div>
                  </button>
                </li>;
              })}
            </ol> : <div className={styles.emptyMatches}>
              <strong>{result ? "No matches returned" : "No card recognized yet"}</strong>
              <p>{result ? "Try a clearer image with the card artwork visible." : "Choose an image, then click the center of a card. Ranked artwork matches will appear here."}</p>
            </div>}
          </div>
          {confirmed ? <p className={styles.confirmed} role="status">Confirmed: {cards.get(confirmed)?.name ?? confirmed}</p> : null}
          <div className={styles.correction}>
            <label htmlFor="vision-correction">Wrong card? Find it by name or passcode</label>
            <input id="vision-correction" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search the local index…" disabled={!result || busy} />
            {matches.length ? <ul>{matches.map(card => <li key={card.cardId}><button type="button" onClick={() => confirm(card.cardId)}>{card.name}</button></li>)}</ul> : query.trim().length >= 2 ? <p>No match in this index. Build the full catalog to add more cards.</p> : null}
            <button type="button" onClick={exportCorrections} disabled={!corrections.length}>Export {corrections.length} confirmation{corrections.length === 1 ? "" : "s"}</button>
          </div>
          <p className={styles.hint}>Similarity ranks artwork matches; it is not a confidence percentage.</p>
        </section>
      </div>

      <section className={styles.diagnostics} aria-labelledby="diagnostics-heading">
        <div className={styles.sectionHead}><h2 id="diagnostics-heading">Recognition diagnostics</h2><span>{result ? `${result.quality.framesUsed} frame${result.quality.framesUsed === 1 ? "" : "s"} used` : "Run recognition to inspect"}</span></div>
        <dl className={styles.quality}>
          <div><dt>Sharpness</dt><dd>{result ? result.quality.sharpness.toFixed(2) : "—"}</dd></div>
          <div><dt>Card detected</dt><dd>{result ? result.quality.detected ? "Yes" : "No" : "—"}</dd></div>
          <div><dt>Corners found</dt><dd>{result ? result.quality.cornersFound ? "Yes" : "No" : "—"}</dd></div>
          <div><dt>Fallback crop</dt><dd>{result ? result.quality.fallback ? "Yes" : "No" : "—"}</dd></div>
          <div><dt>Frame class</dt><dd>{result?.quality.frameClass ?? "—"}</dd></div>
        </dl>
        <dl className={styles.timings}>
          {STAGES.map(stage => <div key={stage}><dt>{stage}</dt><dd>{result ? <>{result.timingsMs[stage].toFixed(1)} <span>ms</span></> : "—"}</dd></div>)}
        </dl>
      </section>
    </main>
  );
}
