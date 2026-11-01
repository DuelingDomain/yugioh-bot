"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { watchVideoFrames } from "@/lib/remote/video-protocol";
import { Icon } from "./icons";
import { detectCards, type BoardRead, type Peek } from "./recognizer";
import { hitTest, neighbour, toFeedCards, type FeedCard, type Pt } from "./quads";
import { useVideoHub, type Health } from "./video-hub";
import s from "./remote-ui.module.css";

/** A card the table has identified on a feed. Normalized to the video frame (0..1). `quad` is set when it came from an outline. */
export type FeedMark = { id: string; x: number; y: number; label: string; notInDecklist: boolean; show: boolean; cardCode?: number; quad?: Pt[] };
/** A reticle for a read in progress, finished or failed. */
export type FeedReticle = { id: string; x: number; y: number; state: "reading" | "done" | "fail"; text: string; quad?: Pt[] };
/** What a click on an outlined card sends up. `anchor` is the card's box on screen (viewport pixels) for popovers. */
export type FeedHit = { x: number; y: number; quad: Pt[]; kind: "face-up" | "face-down"; confidence: number; refined: boolean; covered: boolean; index: number; count: number; anchor: { left: number; top: number; right: number; bottom: number } };
type Box = { left: number; top: number; width: number; height: number };
type Frozen = { pinned: boolean; status: "detecting" | "ready" | "unavailable" | "error"; cards: FeedCard[]; note: string; ms: number; canvas: HTMLCanvasElement; pending: Pt | null };

const CARD_H = 0.34; // card height as a share of the frame height
const CARD_ASPECT = 0.686;
const DWELL_MS = 650;
const AUTO_KEY = "dd-remote-hover-freeze";
const TYPING = "input,textarea,select,[contenteditable=true]";

const readAuto = () => { try { return localStorage.getItem(AUTO_KEY) !== "0"; } catch { return true; } };
const bounds = (quad: Pt[]) => { const xs = quad.map(p => p.x); const ys = quad.map(p => p.y); return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }; };

/** What a board read hands back. `near` is the feed owner\'s side of the mat; `far` is the opposite side. */
export type BoardReading = { near: BoardRead[]; far: BoardRead[]; ms: number };
type PeekLabel = { id: string; state: "loading" | "ready" | "none"; text: string; tier?: Peek["tier"]; covered?: boolean };
type BoardState = { state: "reading" | "done" | "fail"; text: string };

export function Feed({ seat, name, you, health, marks, reticles, onPoint, onSelect, onAdd, onReadBoard, holdSelection, extra, emptyText }: {
  seat: number; name: string; you: boolean; health: Health; marks: FeedMark[]; reticles: FeedReticle[];
  onPoint: (seat: number, x: number, y: number) => void; onSelect: (seat: number, hit: FeedHit) => void; onAdd: (mark: FeedMark) => void;
  /** Called with the cards read from the whole frame. Resolves to a short summary for the feed. */
  onReadBoard?: (seat: number, reading: BoardReading) => Promise<string>;
  /** True while the table shows a popover or tray for a card on this feed. */
  holdSelection: boolean; extra?: ReactNode; emptyText: string;
}) {
  const hub = useVideoHub();
  const source = hub.sourceFor(seat);
  const video = useRef<HTMLVideoElement>(null); const wrap = useRef<HTMLDivElement>(null); const cam = useRef<HTMLDivElement>(null); const holder = useRef<HTMLDivElement>(null);
  const maskId = useId().replace(/:/g, "");
  const [box, setBox] = useState<Box | null>(null);
  const [frozen, setFrozenState] = useState<Frozen | null>(null);
  const [active, setActive] = useState(-1); const [hover, setHover] = useState(-1); const [selected, setSelected] = useState<string | null>(null);
  const [peekLabel, setPeekLabel] = useState<PeekLabel | null>(null); const [board, setBoard] = useState<BoardState | null>(null);
  const peekCache = useRef(new Map<string, PeekLabel>()); const boardRun = useRef<AbortController | null>(null);
  const [hovered, setHovered] = useState(false); const [auto, setAuto] = useState(true); const [say, setSay] = useState("");
  const frozenRef = useRef<Frozen | null>(null); frozenRef.current = frozen;
  const run = useRef(0); const dwell = useRef<ReturnType<typeof setTimeout> | null>(null); const lastMove = useRef<Pt>({ x: -1, y: -1 });
  const setFrozenHealth = hub.setFrozen;

  useEffect(() => { setAuto(readAuto()); }, []);
  useEffect(() => {
    const element = video.current; if (!element || !source) return;
    const detach = source.attach(element);
    const stopWatching = watchVideoFrames(element, stalled => setFrozenHealth(seat, stalled));
    return () => { stopWatching(); detach(); setFrozenHealth(seat, false); };
  }, [source, seat, setFrozenHealth]);

  useEffect(() => {
    const element = video.current; const area = cam.current; if (!element || !area) return;
    const measure = () => {
      const w = area.clientWidth; const h = area.clientHeight; const vw = element.videoWidth; const vh = element.videoHeight;
      if (!w || !h || !vw || !vh) { setBox(null); return; }
      const scale = Math.min(w / vw, h / vh); const width = vw * scale; const height = vh * scale;
      setBox({ left: (w - width) / 2, top: (h - height) / 2, width, height });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(area);
    element.addEventListener("loadedmetadata", measure); element.addEventListener("resize", measure);
    return () => { observer.disconnect(); element.removeEventListener("loadedmetadata", measure); element.removeEventListener("resize", measure); };
  }, [source]);

  const unfreeze = useCallback((message = "") => {
    run.current++; boardRun.current?.abort(); boardRun.current = null; setBoard(null); setPeekLabel(null); peekCache.current.clear(); if (dwell.current) clearTimeout(dwell.current);
    setFrozenState(null); setActive(-1); setHover(-1); setSelected(null); if (message) setSay(message);
  }, []);
  useEffect(() => { if (!source) unfreeze(); }, [source, unfreeze]);
  useEffect(() => () => { if (dwell.current) clearTimeout(dwell.current); }, []);
  // The table closed its popover: the outline stays frozen, only the highlight goes.
  const hadHold = useRef(false);
  useEffect(() => { if (hadHold.current && !holdSelection) setSelected(null); hadHold.current = holdSelection; }, [holdSelection]);
  useEffect(() => { if (frozen?.canvas && holder.current) holder.current.replaceChildren(frozen.canvas); }, [frozen?.canvas]);

  const point = useCallback((clientX: number, clientY: number): Pt | null => {
    const area = cam.current; if (!area || !box) return null;
    const rect = area.getBoundingClientRect();
    const x = (clientX - rect.left - box.left) / box.width; const y = (clientY - rect.top - box.top) / box.height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  }, [box]);
  const anchorOf = useCallback((quad: Pt[]) => {
    const rect = cam.current!.getBoundingClientRect(); const b = bounds(quad); const bx = box ?? { left: 0, top: 0, width: rect.width, height: rect.height };
    return { left: rect.left + bx.left + b.left * bx.width, right: rect.left + bx.left + b.right * bx.width, top: rect.top + bx.top + b.top * bx.height, bottom: rect.top + bx.top + b.bottom * bx.height };
  }, [box]);

  const choose = useCallback((card: FeedCard, count: number, index: number) => {
    setActive(index); setSelected(card.id); setFrozenState(f => f && { ...f, pinned: true });
    setSay(`Card ${index + 1} of ${count}, ${card.kind === "face-up" ? "face up" : "face down"}, selected.`);
    onSelect(seat, { x: card.cx, y: card.cy, quad: card.quad, kind: card.kind, confidence: card.confidence, refined: card.refined, covered: card.covered, index, count, anchor: anchorOf(card.quad) });
  }, [anchorOf, onSelect, seat]);

  const freeze = useCallback(async (pinned: boolean, pending: Pt | null = null) => {
    const element = video.current; if (!element || !element.videoWidth) return;
    if (frozenRef.current) { setFrozenState(f => f && { ...f, pinned: f.pinned || pinned, pending: pending ?? f.pending }); return; }
    const scale = Math.min(1, 1280 / Math.max(element.videoWidth, element.videoHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(element.videoWidth * scale); canvas.height = Math.round(element.videoHeight * scale);
    const context = canvas.getContext("2d"); if (!context) return;
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    const token = ++run.current;
    const base: Frozen = { pinned, status: "detecting", cards: [], note: "", ms: 0, canvas, pending };
    frozenRef.current = base; setFrozenState(base); setActive(-1); setHover(-1); setSelected(null); setSay("Frame frozen. Looking for cards.");
    const result = await createImageBitmap(canvas).then(detectCards, () => ({ status: "error" as const, cards: [] as [], note: "The frame could not be read." }));
    if (token !== run.current) return;
    const cards = result.status === "ready" ? toFeedCards(result.cards) : [];
    const note = result.status === "ready" ? "" : result.note;
    setFrozenState(f => f && { ...f, status: result.status, cards, note, ms: result.status === "ready" ? result.ms : 0 });
    setSay(result.status === "ready" ? (cards.length ? `${cards.length} ${cards.length === 1 ? "card" : "cards"} outlined. Tab moves between cards, Enter opens one, Escape resumes the live feed.` : "No cards found in this frame.") : note);
  }, []);

  // A click that arrived while the frame was still being read lands on its card once the outlines exist.
  useEffect(() => {
    if (!frozen || frozen.status === "detecting" || !frozen.pending || !box) return;
    const p = frozen.pending; setFrozenState(f => f && { ...f, pending: null });
    const hit = hitTest(frozen.cards, p, { w: box.width, h: box.height });
    if (hit) choose(hit, frozen.cards.length, frozen.cards.indexOf(hit)); else onPoint(seat, p.x, p.y);
  }, [frozen, box, choose, onPoint, seat]);

  function click(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    const p = point(event.clientX, event.clientY); if (!p || !box) return;
    wrap.current?.focus({ preventScroll: true });
    const f = frozenRef.current;
    if (!f) { void freeze(true, p); return; }
    setFrozenState(old => old && { ...old, pinned: true });
    if (f.status === "detecting") { setFrozenState(old => old && { ...old, pending: p }); return; }
    const hit = hitTest(f.cards, p, { w: box.width, h: box.height });
    if (hit) choose(hit, f.cards.length, f.cards.indexOf(hit)); else onPoint(seat, p.x, p.y);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const p = point(event.clientX, event.clientY);
    const f = frozenRef.current;
    if (f) {
      if (f.status === "ready" && p && box) { const hit = hitTest(f.cards, p, { w: box.width, h: box.height }); const index = hit ? f.cards.indexOf(hit) : -1; setHover(old => old === index ? old : index); }
      else setHover(-1);
      return;
    }
    if (event.pointerType !== "mouse" || !auto || !source || !p) return;
    if (Math.hypot(event.clientX - lastMove.current.x, event.clientY - lastMove.current.y) < 5 && dwell.current) return;
    lastMove.current = { x: event.clientX, y: event.clientY };
    if (dwell.current) clearTimeout(dwell.current);
    dwell.current = setTimeout(() => { dwell.current = null; void freeze(false); }, DWELL_MS);
  }
  function leave() {
    setHovered(false); setHover(-1); if (dwell.current) { clearTimeout(dwell.current); dwell.current = null; }
    if (frozenRef.current && !frozenRef.current.pinned) unfreeze("Live feed.");
  }
  function key(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement).closest(TYPING)) return;
    const f = frozenRef.current;
    if (event.key === "f" || event.key === "F") { event.preventDefault(); if (f) unfreeze("Live feed."); else void freeze(true); return; }
    if (!f) return;
    if ((event.key === "r" || event.key === "R") && onReadBoard) { event.preventDefault(); void readAll(); return; }
    if (event.key === "Escape") {
      if (selected || holdSelection) { event.preventDefault(); setSelected(null); setSay("Card closed."); } else { event.preventDefault(); unfreeze("Live feed."); }
      return;
    }
    if (f.status !== "ready" || !f.cards.length || !box) return;
    const n = f.cards.length; const scale = { w: box.width, h: box.height };
    let next = -2;
    if (event.key === "Tab") { next = active + (event.shiftKey ? -1 : 1); if (next < 0 || next >= n) { if (active < 0 && !event.shiftKey) next = 0; else return; } }
    else if (event.key === "ArrowRight") next = active < 0 ? 0 : neighbour(f.cards, active, "right", scale);
    else if (event.key === "ArrowLeft") next = active < 0 ? n - 1 : neighbour(f.cards, active, "left", scale);
    else if (event.key === "ArrowDown") next = active < 0 ? 0 : neighbour(f.cards, active, "down", scale);
    else if (event.key === "ArrowUp") next = active < 0 ? n - 1 : neighbour(f.cards, active, "up", scale);
    else if (event.key === "Home") next = 0; else if (event.key === "End") next = n - 1;
    else if ((event.key === "Enter" || event.key === " ") && active >= 0) { event.preventDefault(); choose(f.cards[active], n, active); return; }
    if (next === -2) return;
    event.preventDefault(); setActive(next); setFrozenState(old => old && { ...old, pinned: true });
    const card = f.cards[next]; setSay(`Card ${next + 1} of ${n}, ${card.kind === "face-up" ? "face up" : "face down"}. Enter opens it.`);
  }
  // Hover or keyboard focus on an outline names the card after a short pause. The read stays on this device.
  const shownCard = frozen?.status === "ready" ? frozen.cards[hover >= 0 ? hover : active] : undefined;
  const frame = frozen?.canvas; const frameCards = frozen?.cards; const shownId = shownCard?.id; const shownKind = shownCard?.kind; const shownCovered = shownCard?.covered;
  useEffect(() => {
    if (!shownId || !frame || !frameCards) { setPeekLabel(null); return; }
    if (shownKind === "face-down") { setPeekLabel({ id: shownId, state: "ready", text: "Face-down card" }); return; }
    const cached = peekCache.current.get(shownId); if (cached) { setPeekLabel(cached); return; }
    setPeekLabel({ id: shownId, state: "loading", text: "Reading…", covered: shownCovered });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const card = frameCards.find(item => item.id === shownId); if (!card) return;
      const toRead = (item: FeedCard) => ({ quad: item.quad, kind: item.kind, confidence: item.confidence, partial: !item.refined, ...(item.covered ? { covered: true } : {}) });
      const answer = await hub.peek(seat, frame, toRead(card), frameCards.map(toRead), controller.signal);
      if (controller.signal.aborted) return;
      const label: PeekLabel = answer.status === "ready"
        ? { id: shownId, state: answer.peek.name ? "ready" : "none", text: answer.peek.name ?? "Not sure", tier: answer.peek.tier, covered: answer.peek.covered || card.covered }
        : { id: shownId, state: "none", text: "No preview", covered: card.covered };
      peekCache.current.set(shownId, label); setPeekLabel(label);
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [shownId, shownKind, shownCovered, frame, frameCards, hub, seat]);

  // Reads every outlined card of the frozen frame and hands the result to the table.
  const readAll = useCallback(async () => {
    const f = frozenRef.current; if (!f || f.status !== "ready" || !f.cards.length || board?.state === "reading") return;
    const controller = new AbortController(); boardRun.current = controller;
    setBoard({ state: "reading", text: `Reading ${f.cards.length} ${f.cards.length === 1 ? "card" : "cards"}…` }); setSay(`Reading ${f.cards.length} cards.`);
    const toRead = (item: FeedCard) => ({ quad: item.quad, kind: item.kind, confidence: item.confidence, partial: !item.refined, ...(item.covered ? { covered: true } : {}) });
    const answer = await hub.readBoard(seat, f.canvas, f.cards.map(toRead), controller.signal);
    if (controller.signal.aborted) return;
    boardRun.current = null;
    if (answer.status !== "ready") { setBoard({ state: "fail", text: answer.note || "Board read failed" }); setSay("Board read failed."); return; }
    const summary = onReadBoard ? await onReadBoard(seat, { near: answer.near, far: answer.far, ms: answer.ms }) : `${answer.near.length + answer.far.length} read`;
    setBoard({ state: "done", text: summary }); setSay(summary);
  }, [board?.state, hub, onReadBoard, seat]);

  // F works with the pointer over the feed even when focus sits elsewhere.
  useEffect(() => {
    if (!hovered) return;
    function onKey(event: KeyboardEvent) {
      if ((event.key !== "f" && event.key !== "F") || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement;
      if (target.closest(TYPING) || wrap.current?.contains(target)) return;
      event.preventDefault(); wrap.current?.focus({ preventScroll: true });
      if (frozenRef.current) unfreeze("Live feed."); else void freeze(true);
    }
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  }, [hovered, freeze, unfreeze]);

  const toggleAuto = () => { const on = !auto; setAuto(on); try { localStorage.setItem(AUTO_KEY, on ? "1" : "0"); } catch { /* storage may be blocked */ } };
  const boxStyle: CSSProperties = box ? { left: box.left, top: box.top, width: box.width, height: box.height } : { display: "none" };
  const rect = (x: number, y: number, quad?: Pt[]) => {
    if (!box) return { display: "none" } as const;
    if (quad) { const b = bounds(quad); return { left: box.left + b.left * box.width, top: box.top + b.top * box.height, width: (b.right - b.left) * box.width, height: (b.bottom - b.top) * box.height }; }
    const h = box.height * CARD_H; const w = h * CARD_ASPECT;
    return { left: box.left + x * box.width - w / 2, top: box.top + y * box.height - h / 2, width: w, height: h };
  };
  const shown = hover >= 0 ? hover : active;
  const spot = frozen?.cards.find(c => c.id === selected) ?? (shown >= 0 ? frozen?.cards[shown] : undefined);
  const isFrozen = !!frozen;
  const chip = !frozen ? null
    : frozen.status === "detecting" ? "Reading the frame…"
    : frozen.status === "ready" ? (frozen.cards.length ? `${frozen.cards.length} ${frozen.cards.length === 1 ? "card" : "cards"} outlined` : "No cards found. Click one to read it anyway.")
    : frozen.status === "unavailable" ? "Outlines need the card reader. Click a card to read it here." : "Outlines failed. Click a card to read it here.";

  return <div className={s.cams} ref={wrap} tabIndex={source ? 0 : -1} role="group" onKeyDown={key} onPointerEnter={() => setHovered(true)} onPointerLeave={leave}
    aria-label={`${name}'s field camera. ${you ? "Your" : "Their"} view. Press F to freeze the frame and outline every card. Then Tab moves between cards and Enter opens one.`}
    data-testid={`feed-box-${seat}`} data-frozen={isFrozen ? frozen.status : "live"}>
    <div className={`${s.fcam} ${isFrozen ? s.fcamFrozen : ""}`} ref={cam} onClick={click} onPointerMove={move} data-testid={`feed-${seat}`} data-remote-seat={seat}
      style={{ cursor: !source ? "default" : hover >= 0 ? "pointer" : "crosshair" }}>
      {source ? <video ref={video} autoPlay playsInline muted aria-hidden="true" /> : <div className={s.nofeed}>
        <Icon name="cam" /><span>{emptyText}</span>
      </div>}
      {frozen ? <div className={s.still} style={boxStyle} data-testid="frozen-frame"><div className={s.stillCanvas} ref={holder} /><i className={s.stillScan} hidden={frozen.status !== "detecting"} /></div> : null}
      <div className={s.grain} />
      {frozen && frozen.status === "ready" ? <svg className={s.quads} style={boxStyle} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" data-testid="quads">
        <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1" height="1"><rect width="1" height="1" fill="#fff" />
          {spot ? <polygon points={spot.quad.map(p => `${p.x},${p.y}`).join(" ")} fill="#000" /> : null}</mask></defs>
        {spot ? <rect className={s.spot} width="1" height="1" mask={`url(#${maskId})`} /> : null}
        {frozen.cards.map((card, index) => <polygon key={card.id} points={card.quad.map(p => `${p.x},${p.y}`).join(" ")} style={{ "--i": index } as CSSProperties}
          className={`${s.qpoly} ${card.kind === "face-down" ? s.qdown : ""} ${card.covered ? s.qcov : ""} ${index === shown ? s.qhot : ""} ${card.id === selected ? s.qon : ""}`} data-testid="quad" data-kind={card.kind} data-selected={card.id === selected} data-active={index === active} />)}
      </svg> : null}
      {frozen && frozen.status === "ready" ? <div className={s.qnums} style={boxStyle} aria-hidden="true">
        {frozen.cards.map((card, index) => <span key={card.id} className={`${s.qn} ${index === shown || card.id === selected ? s.qnOn : ""}`} style={{ left: `${card.bounds.left * 100}%`, top: `${card.bounds.top * 100}%` }}>{index + 1}</span>)}
      </div> : null}
      {frozen && frozen.status === "ready" && peekLabel && shownCard && peekLabel.id === shownCard.id && !selected ? <div className={`${s.peek2} ${peekLabel.state === "loading" ? s.peek2Wait : ""} ${peekLabel.covered ? s.peek2Cov : ""}`} role="status" data-testid="peek-label"
        style={{ left: box ? box.left + shownCard.bounds.right * box.width + 8 : 0, top: box ? box.top + shownCard.bounds.top * box.height : 0, transform: shownCard.bounds.right > 0.7 ? "translateX(calc(-100% - 16px - " + ((shownCard.bounds.right - shownCard.bounds.left) * (box?.width ?? 0)) + "px))" : undefined }}>
        <b>{peekLabel.text}</b>
        {peekLabel.tier && peekLabel.state !== "loading" ? <em>{peekLabel.tier === "sure" ? "Sure" : peekLabel.tier === "not sure" ? "Not sure" : "Low match"}</em> : null}
        {peekLabel.covered ? <em>Covered</em> : null}
      </div> : null}
      {board ? <div className={`${s.boardbar} ${board.state === "reading" ? s.boardbarWait : ""} ${board.state === "fail" ? s.boardbarFail : ""}`} role="status" data-testid="board-status" data-state={board.state}>
        <span>{board.text}</span>{board.state === "reading" ? <i aria-hidden="true" /> : <button type="button" onClick={() => setBoard(null)} aria-label="Dismiss"><Icon name="x" /></button>}
      </div> : null}
      {marks.map(mark => {
        const r = rect(mark.x, mark.y, mark.quad); const rh = typeof r.height === "number" ? r.height : 0; const rt = typeof r.top === "number" ? r.top : 0;
        const flip = box ? rt + rh + (mark.notInDecklist ? 62 : 30) > (wrap.current?.clientHeight ?? 0) : false;
        return <div key={mark.id} className={`${s.lk} ${mark.notInDecklist ? s.nid : ""} ${mark.show ? s.show : ""}`} style={r} data-testid="lock">
          <span className={s.lb} style={flip ? { top: "auto", bottom: "calc(100% + 8px)" } : undefined}>{mark.label}</span>
          {mark.notInDecklist ? <span className={s.nidc} style={flip ? { top: "auto", bottom: "calc(100% + 32px)" } : undefined}>
            <Icon name="warn" />Not in decklist<button type="button" onClick={() => onAdd(mark)}>Add to decklist</button>
          </span> : null}
        </div>;
      })}
      {reticles.map(r => <div key={r.id} className={`${s.ret} ${r.state === "done" ? s.done : r.state === "fail" ? s.fail : ""}`} style={rect(r.x, r.y, r.quad)} data-testid="reticle"><i /><b>{r.text}</b></div>)}
    </div>
    <span className={s.ctag}><i />{you ? "YOUR FIELD CAM" : "FIELD CAM"}</span>
    {source ? <div className={`${s.fctl} ${isFrozen ? s.fctlOn : ""}`}>
      {isFrozen ? <>
        <span className={s.fzchip} role="status" data-testid="freeze-status" data-state={frozen.status}><Icon name={frozen.status === "detecting" ? "cam" : "check"} />{chip}</span>
        {onReadBoard && frozen.status === "ready" && frozen.cards.length ? <button type="button" className={s.fzbtn} disabled={board?.state === "reading"} onClick={() => void readAll()} data-testid="read-board" aria-keyshortcuts="R">
          {board?.state === "reading" ? "Reading…" : "Read board"} <kbd>R</kbd></button> : null}
        <button type="button" className={s.fzbtn} onClick={() => unfreeze("Live feed.")} data-testid="resume-live">Resume live <kbd>Esc</kbd></button>
      </> : <>
        <button type="button" className={s.fzbtn} onClick={() => void freeze(true)} data-testid="freeze-feed" aria-keyshortcuts="F">Freeze <kbd>F</kbd></button>
        <button type="button" className={`${s.fzbtn} ${s.fzauto}`} aria-pressed={auto} onClick={toggleAuto} title="Freeze the frame when the pointer rests on the feed">Hover freeze {auto ? "on" : "off"}</button>
      </>}
    </div> : null}
    <div className={s.sr} aria-live="polite" role="status">{say}</div>
    {extra}
  </div>;
}
