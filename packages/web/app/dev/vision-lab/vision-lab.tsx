"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { createRecognizer, yugioh, hitTestQuad, type IdentityEmbedder, type DetectedQuad, type AIReading, type IndexMeta, type RecognitionResult, type FeedbackSource, isPhysicalEntry, catalogCardId } from "@yugidraft/vision";
import { VisionFeedbackSetting, type FeedbackPreference } from "@/components/settings/vision-feedback-setting";
import { useVisionSource } from "./use-vision-source";
import { useOutlineReads } from "./use-outline-reads";
import {RealsetCapture} from "./realset-capture";
import { VisionResult } from "./vision-result";
import styles from "./vision-lab.module.css";
import { AutoDetectLab } from "./auto-detect-lab";
import dynamic from "next/dynamic";
const RecordSession = dynamic(() => import("./session/record-session"));

// Correction interaction adapted from Duel Lens's popover/keys/search UI (Apache-2.0).
// Modified for React and a local exportable correction log; no extension/report service.
// Licence: packages/vision/src/licenses/duel-lens.LICENSE.
interface Correction { model:IdentityEmbedder; at: string; guessed?: string; chosen: string; tier: RecognitionResult['tier']; sharpness: number; }
type Backend = "auto" | "wasm";
type Recognizer = ReturnType<typeof createRecognizer>;
type CardEntry = IndexMeta["entries"][number];
interface Selection { card?:DetectedQuad; point: { x: number; y: number }; left: number; top: number }
const STAGES = ["sharpness", "detect", "warp", "embed", "search", "total"] as const;

function thumbnail(cardId: string, entry?: CardEntry): string | undefined {
  if (cardId === yugioh.cardBack.cardId) return yugioh.cardBack.imageUrl;
  if (entry?.thumbnailUrl) return entry.thumbnailUrl;
  if (entry?.imageId && entry.imageId !== entry.passcode && entry.imageUrl) return entry.imageUrl;
  if (entry?.passcode) return `/api/cards/${entry.passcode}/image?size=small`;
  return entry?.imageUrl;
}

export function VisionLab({defaultEmbedder='dinov2-small-duel'}:{defaultEmbedder?:IdentityEmbedder}={}) {
  const [tab,setTab]=useState<'manual'|'auto'|'session'>('manual');
  return <><nav className={styles.controls} aria-label="Vision lab modes" style={{padding:20}} role="tablist"><button type="button" role="tab" aria-selected={tab==='manual'} onClick={()=>setTab('manual')}>Click reader</button><button type="button" role="tab" aria-selected={tab==='auto'} onClick={()=>setTab('auto')}>Auto-detect</button><button type="button" role="tab" aria-selected={tab==='session'} onClick={()=>setTab('session')}>Record session</button></nav>{tab==='session'?<RecordSession/>:tab==='auto'?<main className={styles.lab}><h1>Auto-detect field lab</h1><AutoDetectLab defaultEmbedder={defaultEmbedder}/></main>:<ManualVisionLab defaultEmbedder={defaultEmbedder}/>}</>;
}

function ManualVisionLab({defaultEmbedder}:{defaultEmbedder:IdentityEmbedder}) {
  const recognizerRef = useRef<{ backend: Backend; embedder:IdentityEmbedder; value: Recognizer } | null>(null);
  const runRef = useRef(0);
  const busyRef = useRef(false);
  const frozenRef = useRef<ImageBitmap | null>(null);
  const frozenUrlRef = useRef<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const aiControllerRef = useRef<AbortController | null>(null);
  const [frozenUrl, setFrozenUrl] = useState<string | null>(null);
  const [quads, setQuads] = useState<DetectedQuad[]>([]);
  const [popover, setPopover] = useState(false);
  const [flash,setFlash]=useState<DetectedQuad|null>(null);
  const [aiReading, setAiReading] = useState<AIReading | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [backend, setBackend] = useState<Backend>("auto");
  const [embedder, setEmbedder] = useState<IdentityEmbedder>(defaultEmbedder);
  const [busy, setBusy] = useState(false);
  const [captureMode,setCaptureMode]=useState(false);
  const [deck,setDeck]=useState('');
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [cards, setCards] = useState<Map<string, CardEntry>>(() => new Map());
  const [query, setQuery] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [feedbackPreference,setFeedbackPreference]=useState<FeedbackPreference|null>(null);
  const [feedbackStatus,setFeedbackStatus]=useState('');
  const feedbackEnabled=Boolean(feedbackPreference?.enabled&&feedbackPreference.collectionEnabled);
  const [metadataError, setMetadataError] = useState(false);
  useEffect(()=>{if(!flash)return;const timer=setTimeout(()=>setFlash(null),1400);return()=>clearTimeout(timer);},[flash]);
  function reader() {
    if(!recognizerRef.current || recognizerRef.current.backend!==backend || recognizerRef.current.embedder!==embedder) {
      recognizerRef.current?.value.dispose();recognizerRef.current={backend,embedder,value:createRecognizer({game:'yugioh',backend,embedder})};
    }
    return recognizerRef.current.value;
  }
  const outlineReads=useOutlineReads(frozenRef,reader,busyRef,setBusy,setError);
  const resetOutlineReads=outlineReads.reset;

  const disposeRecognizer = useCallback(() => {
    runRef.current += 1;
    busyRef.current = false;
    recognizerRef.current?.value.dispose();
    recognizerRef.current = null;
  }, []);

  const clearFrozen = useCallback(() => {
    resetOutlineReads();
    frozenRef.current?.close(); frozenRef.current=null;
    if(frozenUrlRef.current) URL.revokeObjectURL(frozenUrlRef.current);
    frozenUrlRef.current=null;setFrozenUrl(null);setQuads([]);setPopover(false);setSelection(null);setFlash(null);setResult(null);setConfirmed(null);
  },[resetOutlineReads]);
  const reset = useCallback(() => {
    clearFrozen(); aiControllerRef.current?.abort(); setAiBusy(false);setAiReading(null);setAiError(null);
    disposeRecognizer();
    setBusy(false);
    setResult(null);
    setError(null);
    setSelection(null);
    setConfirmed(null);
    setQuery("");
  }, [disposeRecognizer,clearFrozen]);
  const source = useVisionSource(reset);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(yugioh.metaUrl, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Card metadata is unavailable");
        const meta = await response.json() as IndexMeta;
        if (!Array.isArray(meta.entries)) throw new Error("Card metadata is invalid");
        if (!controller.signal.aborted) setCards(new Map(meta.entries.filter(isPhysicalEntry).map(entry => [entry.cardId, entry])));
      })
      .catch(() => { if (!controller.signal.aborted) setMetadataError(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => () => { disposeRecognizer(); frozenRef.current?.close(); if(frozenUrlRef.current) URL.revokeObjectURL(frozenUrlRef.current); aiControllerRef.current?.abort(); }, [disposeRecognizer]);
  const freeze = async () => {
    if(busyRef.current) return;
    if(frozenRef.current) { clearFrozen();setResult(null);aiControllerRef.current?.abort();setAiBusy(false);return; }
    const run=++runRef.current;busyRef.current=true;setBusy(true);setError(null);setResult(null);setConfirmed(null);
    let snapshots:ImageBitmap[]=[],detectionFrame:ImageBitmap|undefined;
    try {
      snapshots=await source.snapshot();if(run!==runRef.current) return;
      const frame=snapshots[snapshots.length-1];
      const canvas=document.createElement('canvas');canvas.width=frame.width;canvas.height=frame.height;
      canvas.getContext('2d')!.drawImage(frame,0,0);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Freeze failed')),'image/jpeg',.9));
      if(run!==runRef.current) return;
      const frozen=await createImageBitmap(frame);
      if(run!==runRef.current) {frozen.close();return;}
      frozenRef.current=frozen;
      frozenUrlRef.current=URL.createObjectURL(blob);setFrozenUrl(frozenUrlRef.current);
      detectionFrame=await createImageBitmap(frame);
      if(run!==runRef.current) return;
      const detections=await reader().detectCards(detectionFrame);
      if(run===runRef.current) {setQuads(detections);setResult(null);setConfirmed(null);setSelection(null);}
    } catch(cause) {if(run===runRef.current) {clearFrozen();setError(cause instanceof Error?cause.message:'Freeze failed');}}
    finally {detectionFrame?.close();for(const f of snapshots) f.close();if(run===runRef.current){busyRef.current=false;setBusy(false);}}
  };
  const askAI = async () => {
    if(!result || aiBusy) return;
    aiControllerRef.current?.abort();const controller=new AbortController();aiControllerRef.current=controller;
    setAiBusy(true);setAiError(null);setAiReading(null);
    try {const reading=await reader().askAI(result,{explicitRequest:true,signal:controller.signal});if(!controller.signal.aborted)setAiReading(reading);}
    catch(cause) {if(!controller.signal.aborted)setAiError(cause instanceof Error?cause.message:'AI reading failed');}
    finally {if(!controller.signal.aborted)setAiBusy(false);}
  };

  const recognize = async (point = selection?.point ?? { x: 0.5, y: 0.5 }, selectedCard:DetectedQuad|null|undefined=frozenRef.current?selection?.card:undefined) => {
    if (busyRef.current || !source.source || !feedbackPreference) return;
    busyRef.current = true;
    const run = ++runRef.current;
    setBusy(true);
    setError(null);setPopover(true);setFlash(null);setResult(null);setConfirmed(null);setFeedbackStatus('');aiControllerRef.current?.abort();setAiBusy(false);setAiReading(null);setAiError(null);
    let frames: ImageBitmap[] = [];
    try {
      await outlineReads.cancelPeek();
      if(run!==runRef.current)return;
      frames = frozenRef.current ? [await createImageBitmap(frozenRef.current)] : await source.snapshot();
      if (run !== runRef.current) return;
      const activeReader = reader();
      // The worker takes ownership of these clones; the source keeps its originals.
      const live=source.source==='camera'&&!frozenRef.current;
      const next = await activeReader.recognize(frames, { clickPoint: point, k: 5, includeCrop:true,deferAICrop:!captureMode,includeFeedback:feedbackEnabled&&!captureMode, card:selectedCard??undefined,includeRaw:captureMode,earlyExit:!captureMode,...(live&&!captureMode?{maxFrames:1 as const}:{}),...(captureMode&&deck.trim()?{priors:{decklist:deck.split(/[\s,]+/).filter(id=>/^\d+$/.test(id))}}:{}) });
      if (run === runRef.current) {
        if(live&&!next.detectedCard&&!captureMode)throw new Error('No card detected under this click.');
        setResult(next);setConfirmed(null);setQuery('');if(live&&next.detectedCard)setFlash(next.detectedCard);
      }
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

  const recognizeAt = (event: MouseEvent<HTMLDivElement>) => {
    const { width, height } = source.dimensions;
    if (!width || !height || busyRef.current || !source.source || !feedbackPreference) return;
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
    const hit=frozenRef.current?hitTestQuad(quads,{x,y},{width:visibleWidth,height:visibleHeight}):-1;
    if(frozenRef.current && hit<0 && !captureMode) return;
    const next = { card:hit>=0?quads[hit]:undefined, point: { x, y }, left: localX / rect.width * 100, top: localY / rect.height * 100 };
    setSelection(next);
    void recognize(next.point,hit>=0?quads[hit]:null);
  };

  const confirm = useCallback((cardId: string, source:FeedbackSource="pick") => {
    if (!result || busy || !catalogCardId(cards.get(cardId))) return;
    setConfirmed(cardId);setPopover(false);previewRef.current?.focus();
    if(!captureMode && feedbackEnabled && result.feedback && recognizerRef.current) {
      setFeedbackStatus('Saving recognition sample…');
      void recognizerRef.current.value.recordFeedback(result,cardId,source).then(()=>setFeedbackStatus('Recognition sample saved.'),error=>setFeedbackStatus(error instanceof Error?error.message:'Feedback could not be saved.'));
    }
    setCorrections(log => [...log, { at: new Date().toISOString(), model:embedder, guessed: result.candidates[0]?.cardId,
      chosen: cardId, tier: result.tier, sharpness: result.quality.sharpness }]);
  }, [result, busy,feedbackEnabled,cards,captureMode,embedder]);
  useEffect(() => {
    const pick = (event: KeyboardEvent) => {
      if(event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat) return;
      if(event.key==='Escape' && popover) {event.preventDefault();setPopover(false);previewRef.current?.focus();return;}
      if(event.key==='Escape' && outlineReads.peek) {event.preventDefault();void outlineReads.cancelPeek();return;}
      if (event.target instanceof HTMLElement && (event.target.matches("input,select,textarea") || event.target.isContentEditable)) return;
      if(event.key==='ArrowDown' || event.key==='ArrowUp') {
        if(!popover) return;const buttons=[...(popoverRef.current?.querySelectorAll<HTMLButtonElement>('button')??[])];
        const at=buttons.indexOf(document.activeElement as HTMLButtonElement);if(buttons.length){event.preventDefault();buttons[at<0?(event.key==='ArrowDown'?0:buttons.length-1):(at+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}return;
      }
      const index = Number(event.key) - 1;
      if (index >= 0 && index < 5 && result?.candidates[index]) { event.preventDefault(); confirm(result.candidates[index].cardId); }
    };
    window.addEventListener("keydown", pick);
    return () => window.removeEventListener("keydown", pick);
  }, [confirm, result,popover,outlineReads.peek,outlineReads.cancelPeek]);
  useEffect(()=>{
    if(!popover) return;
    popoverRef.current?.focus();
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node && !popoverRef.current?.contains(event.target)) {setPopover(false);previewRef.current?.focus();}};
    document.addEventListener('pointerdown',outside);
    return ()=>document.removeEventListener('pointerdown',outside);
  },[popover]);
  const matches = query.trim().length >= 2 ? [...cards.values()].filter(card =>
    card.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) || String(card.passcode).includes(query.trim())).slice(0, 8) : [];
  const exportCorrections = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ game: yugioh.id, corrections }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "vision-corrections.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const ready = source.source !== null && source.frameCount > 0 && !source.preparing && feedbackPreference!==null;
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

      <VisionFeedbackSetting onChange={setFeedbackPreference} promptOnly />
      <RealsetCapture busy={busy} enabled={captureMode} onEnabledChange={value=>{setCaptureMode(value);setResult(null);setConfirmed(null);}} result={result} confirmed={confirmed} frame={frozenRef} source={source.source} point={selection?.point??{x:.5,y:.5}} deck={deck} onDeckChange={value=>{setDeck(value);setResult(null);setConfirmed(null);}} />
      {feedbackStatus?<p role="status">{feedbackStatus}</p>:null}
      <div className={styles.workspace}>
        <section className={styles.capture} aria-labelledby="capture-heading">
          <div className={styles.sectionHead}>
            <h2 id="capture-heading">Image source</h2>
            <span>{source.source === "camera" ? "Live camera" : source.source === "photo" ? "Uploaded photo" : "No source"}</span>
          </div>
          <div className={styles.controls}>
            <button className={styles.primary} type="button" onClick={() => { void source.startCamera(); }} disabled={source.preparing}>Start camera</button>
            <button type="button" onClick={() => uploadRef.current?.click()}>Upload photo</button>
            <button type="button" onClick={() => {void freeze();}} disabled={!ready || busy}>{frozenUrl ? "Resume" : "Freeze & outline cards"}</button>
            <button type="button" onClick={source.stop} disabled={!source.source && !source.preparing}>Stop</button>
            <input ref={uploadRef} type="file" accept="image/*" className={styles.fileInput} aria-label="Upload a card photo" onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void source.loadPhoto(file);
            }} />
          </div>

          <div ref={previewRef} role="button" tabIndex={0} className={styles.preview} onClick={recognizeAt} aria-disabled={!ready || busy} onKeyDown={event=>{if(event.target===event.currentTarget && (event.key==='Enter' || event.key===' ')) {event.preventDefault();if(ready && !busy) void recognize();}}} aria-label="Recognize a card: click its center in the image, or press Enter to use the image center">
            <video ref={source.videoRef} autoPlay muted playsInline hidden={source.source !== "camera" || !!frozenUrl} />
            {frozenUrl || source.photoUrl ? <img src={frozenUrl ?? source.photoUrl!} alt="Uploaded card photo" /> : null}
            {!source.source ? <span className={styles.placeholder}>
              <span className={styles.cardOutline} aria-hidden="true" />
              <strong>{source.preparing ? "Preparing image…" : "Bring a card into view"}</strong>
              <span>{source.preparing ? "Your image will appear here." : "Start the camera or upload a photo."}</span>
            </span> : null}
            {frozenUrl ? <svg className={styles.outlines} viewBox={`0 0 ${source.dimensions.width} ${source.dimensions.height}`} aria-label="Detected card outlines">
              {quads.map((card,index)=><polygon key={index} points={card.quad.map(p=>`${p.x*source.dimensions.width},${p.y*source.dimensions.height}`).join(' ')} role="button" tabIndex={0} aria-label={`Read card ${index+1}${card.kind==='face-down'?' (face down)':''}${card.partial?' (partial)':''}`} aria-describedby={outlineReads.peek?.index===index?'card-peek':undefined}
                onMouseEnter={event=>outlineReads.showPeek(index,quads,event.currentTarget.getBoundingClientRect())}
                onFocus={event=>{if(!popover)outlineReads.showPeek(index,quads,event.currentTarget.getBoundingClientRect());}}
                onMouseLeave={event=>{if(document.activeElement!==event.currentTarget)outlineReads.leavePeek();}}
                onBlur={()=>outlineReads.leavePeek()}
                onKeyDown={event=>{if(event.key==='Enter' || event.key===' ') {event.preventDefault();event.stopPropagation();const x=card.quad.reduce((s,p)=>s+p.x,0)/4,y=card.quad.reduce((s,p)=>s+p.y,0)/4;const point={x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};setSelection({point,card,left:point.x*100,top:point.y*100});void recognize(point,card);}}} />)}
            </svg> : null}
            {flash&&!frozenUrl?<svg className={`${styles.outlines} ${styles.liveFlash}`} viewBox={`0 0 ${source.dimensions.width} ${source.dimensions.height}`} aria-label="Selected card outline"><polygon points={flash.quad.map(p=>`${p.x*source.dimensions.width},${p.y*source.dimensions.height}`).join(' ')} /></svg>:null}
            {selection && source.source ? <span className={styles.target} style={{ left: `${selection.left}%`, top: `${selection.top}%` }} aria-hidden="true" /> : null}
            {busy ? <span className={styles.working}>Recognizing…</span> : null}
          </div>

          {frozenUrl ? <><p className={styles.hint}>{quads.length} detected card{quads.length===1?'':'s'} · gold outlines · Hover or focus to peek · Enter to read</p>
            <div className={styles.controls}>
              <label>Camera side <select aria-label="Board side" value={outlineReads.side} disabled={busy} onChange={e=>outlineReads.setSide(e.target.value as 'near'|'far')}><option value="near">Near</option><option value="far">Far</option></select></label>
              <label>Fill seat <select aria-label="Board twin seat" value={outlineReads.seat} disabled={busy} onChange={e=>outlineReads.setSeat(e.target.value)}>{[0,1,2,3].map(seat=><option key={seat} value={seat}>Seat {seat+1}</option>)}</select></label>
              <button type="button" disabled={busy || !quads.length} onClick={()=>{setPopover(false);setError(null);void outlineReads.readAll(quads);}}>Read all cards</button>
              {outlineReads.reading ? <button type="button" onClick={outlineReads.cancelBoard}>Cancel board read</button> : null}
            </div></> : null}
          <div className={styles.sourceInfo}>
            <span>{source.dimensions.width ? `${source.dimensions.width} × ${source.dimensions.height}` : "Full-resolution capture"}</span>
            <span>{source.source === "camera" ? `${source.frameCount}/6 buffered · 5 fps max · 1 second` : source.source === "photo" ? "1 photo frame" : "Camera permission required"}</span>
          </div>

          <div className={styles.runControls}>
            <label htmlFor="vision-embedder">Embedder
              <select id="vision-embedder" value={embedder} disabled={busy} onChange={event => {
                aiControllerRef.current?.abort();setAiBusy(false);setAiReading(null);setAiError(null);
                disposeRecognizer();resetOutlineReads();setResult(null);setConfirmed(null);setError(null);setFeedbackStatus('');
                setEmbedder(event.target.value as IdentityEmbedder);
              }}>
                <option value="dinov2-small-duel">DINOv2-duel</option>
                <option value="dinov3-small">DINOv3-S</option>
              </select>
            </label>
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
          {embedder==='dinov3-small'?<p className={styles.hint}>Pretrained DINOv3-S · experimental, confidence thresholds are not calibrated. Switch on the same frozen card to compare.</p>:null}
          <p className={styles.hint}>Keep the card steady and evenly lit. The first recognition loads the local models and card index.</p>
          {activeError ? <p className={styles.error} role="alert">{activeError}</p> : null}
        </section>

        <section className={styles.matches} aria-labelledby="matches-heading">
          <div className={styles.sectionHead}>
            <h2 id="matches-heading">Top 5 matches</h2>
            <span>{result ? `${result.timingsMs.total.toFixed(1)} ms/read · ${result.timingsMs.embed.toFixed(1)} ms embed · ${result.backend}` : "Awaiting recognition"}</span>
          </div>
          {metadataError ? <p className={styles.warning}>Card names and thumbnails are unavailable. Prepare the vision index, then reload.</p> : null}
          <div aria-live="polite" aria-busy={busy}>
            {result ? <p className={styles.tier} data-tier={result.tier}>{result.tier} <span>· pick a match or press 1–5 to confirm</span></p> : null}
            {result?.quality.notInDecklist?<p>Not in decklist</p>:null}
            {result?.candidates.length ? <ol className={styles.candidates}>
              {result.candidates.slice(0, 5).map((candidate, index) => {
                const entry = cards.get(candidate.cardId);
                const image = thumbnail(candidate.cardId, entry);
                const name = entry?.name ?? (candidate.cardId === yugioh.cardBack.cardId ? "Card back" : candidate.cardId);
                return <li key={candidate.cardId} className={index === 0 ? styles.best : undefined}>
                  <button type="button" className={styles.pick} onClick={() => confirm(candidate.cardId)} disabled={busy || !catalogCardId(entry)} aria-label={`Confirm match ${index + 1}: ${name}`} aria-pressed={confirmed === candidate.cardId}>
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
          {result ? <div className={styles.ai}>
            <button type="button" onClick={()=>{void askAI();}} disabled={!(result.aiCropJpeg||result.aiCropToken) || busy || aiBusy}>{aiBusy?'Reading…':'Ask AI'}</button>
            <span>Sends this high-resolution card crop to Anthropic. Owner access and server opt-in required.</span>
            {result.quality.fullArt && !result.quality.fullArtReferences ? <p>Possible full-art layout; no verified full-art references. Use name correction or Ask AI.</p> : null}
            {aiError ? <p role="alert">{aiError}</p> : null}
            {aiReading ? <p role="status">{aiReading.match ? <><strong>{aiReading.match.name}</strong>{aiReading.setCode?` · ${aiReading.setCode}`:''} <button type="button" onClick={()=>confirm(String(aiReading.match!.passcode),"ai")}>Confirm AI match</button></> : 'AI could not identify a catalog card.'}</p> : null}
          </div> : null}
          {confirmed ? <p className={styles.confirmed} role="status">Confirmed: {cards.get(confirmed)?.name ?? confirmed}</p> : null}
          <div className={styles.correction}>
            <label htmlFor="vision-correction">Wrong card? Find it by name or passcode</label>
            <input id="vision-correction" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search the local index…" disabled={!result || busy} />
            {matches.length ? <ul>{matches.map(card => <li key={card.cardId}><button type="button" onClick={() => confirm(card.cardId,"search")}>{card.name}</button></li>)}</ul> : query.trim().length >= 2 ? <p>No match in this index. Build the full catalog to add more cards.</p> : null}
            <button type="button" onClick={exportCorrections} disabled={!corrections.length}>Export {corrections.length} confirmation{corrections.length === 1 ? "" : "s"}</button>
          </div>
          <p className={styles.hint}>Similarity ranks artwork matches; it is not a confidence percentage.</p>
        </section>
      </div>

      {popover ? <div ref={popoverRef} className={styles.popover} role="dialog" aria-label="Card matches" aria-busy={busy} tabIndex={-1}>
        <button type="button" aria-label="Close card matches" onClick={()=>{setPopover(false);previewRef.current?.focus();}}>×</button>
        <VisionResult result={result} cards={cards} busy={busy} error={error} onConfirm={confirm} />
      </div> : null}
      {outlineReads.peek ? <div id="card-peek" role="tooltip" className={styles.peek} style={{left:outlineReads.peek.left,top:outlineReads.peek.top}} onMouseEnter={outlineReads.keepPeek} onMouseLeave={outlineReads.leavePeek}>
        <strong>{outlineReads.peek.value?.faceDown?'Face down':outlineReads.peek.value?.name??(outlineReads.peek.error?'Peek unavailable':outlineReads.peek.value?'No match':'Reading…')}</strong>
        <span>{outlineReads.peek.error??outlineReads.peek.value?.tier}</span>
        {outlineReads.peek.value?.covered ? <span>Covered card · verify manually</span> : null}
      </div> : null}
      {outlineReads.board ? <section className={styles.board} aria-label="Board reading">
        <h2>Board reading · {outlineReads.board.timingsMs.total.toFixed(1)} ms</h2>
        <p>Near and far follow the image midpoint. Uncertain names need verification.</p>
        {(['near','far'] as const).map(side=><div key={side}><h3>{side==='near'?'Near':'Far'} · {outlineReads.board![side].length} cards</h3><ul>{outlineReads.board![side].map(card=><li key={card.index}>{card.faceDown?'Face down':card.name??'Unknown'} · {card.tier}{card.covered?' · covered':''}{card.error?` · ${card.error}`:''}</li>)}</ul></div>)}
        {Object.entries(outlineReads.twins).map(([seat,cards])=><div key={seat} aria-label={`Seat ${Number(seat)+1} board twin`}><h3>Seat {Number(seat)+1} board twin</h3><ul>{cards.map(card=><li key={card.index}>{card.faceDown?'Face down':card.name??'Unknown'}{card.tier!=='sure'?' · unconfirmed':''}</li>)}</ul>{!cards.length?<p>No cards on the selected side.</p>:null}</div>)}
      </section> : null}
      <section className={styles.diagnostics} aria-labelledby="diagnostics-heading">
        <div className={styles.sectionHead}><h2 id="diagnostics-heading">Recognition diagnostics</h2><span>{result ? `${result.quality.framesUsed} frame${result.quality.framesUsed === 1 ? "" : "s"} used` : "Run recognition to inspect"}</span></div>
        <dl className={styles.quality}>
          <div><dt>Sharpness</dt><dd>{result ? result.quality.sharpness.toFixed(2) : "—"}</dd></div>
          <div><dt>Card detected</dt><dd>{result ? result.quality.detected ? "Yes" : "No" : "—"}</dd></div>
          <div><dt>Corners found</dt><dd>{result ? result.quality.cornersFound ? "Yes" : "No" : "—"}</dd></div>
          <div><dt>Fallback crop</dt><dd>{result ? result.quality.fallback ? "Yes" : "No" : "—"}</dd></div>
          <div><dt>Frame class</dt><dd>{result?.quality.frameClass ?? "—"}</dd></div>
          <div><dt>Covered guard</dt><dd>{result ? result.quality.covered ? "Suppressed confidence" : "No overlap found" : "—"}</dd></div>
        </dl>
        <dl className={styles.timings}>
          {STAGES.map(stage => <div key={stage}><dt>{stage}</dt><dd>{result ? <>{result.timingsMs[stage].toFixed(1)} <span>ms</span></> : "—"}</dd></div>)}
        </dl>
      </section>
    </main>
  );
}
