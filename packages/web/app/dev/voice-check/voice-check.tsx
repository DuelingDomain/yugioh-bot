"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ygoModule, remoteActionSchema, type RemoteState } from "@yugidraft/shared/remote";
import { interpret, type GrammarContext, type VoiceIntent } from "@/components/remote/ui/grammar";
import { cardInfo, loadCards } from "@/components/remote/ui/catalog";
import { createSentencePiece, type SentencePieceVocab } from "@/components/remote/ui/voice/sentencepiece";
import { DEFAULT_PHRASE_OPTIONS, buildPhrases, combineHits, isChatter, placeholderLine, type Combined, type PhraseSet } from "@/components/remote/ui/voice/phrases";
import { HEARD_PHASES, PHASE_LABEL, VOICE_PHASES, heardPhaseOf, judgePhaseWord, type HeardPhase, type VoicePhase } from "@/components/remote/ui/voice/phase-plausibility";
import { ASR_BASE, KwsClient, type KwsReady, type KwsStatus, type KwsUtterance } from "@/components/remote/ui/voice/kws-client";
import { buildMatcher } from "@/components/remote/ui/voice/speech-matcher";
import vocab from "@/components/remote/ui/voice/sp-vocab.json";

const sp = createSentencePiece(vocab as SentencePieceVocab);
const MIC_KEY = "voice-check-mic";
const NO_SOUND_MS = 3000;
const CHAT_MS = 10 * 60 * 1000;
const PLAYERS = [{ seat: 0, displayName: "Me" }, { seat: 1, displayName: "Opponent" }];

/** "kws" = Method A, keyword spotting (old). "asr" = Method B, speech model + grammar matcher (new). */
type Method = "kws" | "asr";
const METHOD_KEY = "voice-check-method";
type Row = { id: number; method: Method; at: string; heard: string; tags: string; canonical: string; intent: string; acts: boolean; note: string; busyMs: number; audioMs: number; speechMs: number };
type SavedDeck = { id: number; name: string; deck: { main: number[]; extra: number[]; side: number[] } };

function describe(intent: VoiceIntent): string {
  switch (intent.kind) {
    case "phase": return `phase -> ${intent.phase}`;
    case "attack": return `attack (${intent.resolution.status})`;
    case "effect": return `effect${intent.proposal.type === "effect.activated" && intent.proposal.source.name ? ` of ${intent.proposal.source.name}` : " (which card?)"}`;
    case "move": return `move ${JSON.stringify(intent.move)}`;
    case "name": return `card name "${intent.name}"`;
    case "none": return "nothing";
    case "lp": return `LP ${intent.delta}`;
    case "pick": return `pick ${intent.index + 1}`;
    default: return intent.kind;
  }
}

/** A two-player fixture in the second turn: the first deck names sit on my field, so "attack with <name>" has something to find. */
function fixture(names: string[], phase: VoicePhase, turn: number): RemoteState {
  let state = { ...ygoModule.initialState({ seatCount: 2 }), turn, phase } as RemoteState;
  try {
    names.slice(0, 6).forEach((name, index) => {
      state = ygoModule.reduce(state, remoteActionSchema.parse({ type: "twin.place", actorSeat: index % 2, seat: index % 2, zone: "monster", at: 1000 + index,
        idempotencyKey: `voice-check-${index}`, card: { ref: `fx-${index}`, name, slot: Math.floor(index / 2) + 1, faceUp: true, position: "attack" } }));
    });
  } catch { /* an odd name only loses the fixture field */ }
  return state;
}

/** One decision for both methods: the same chatter gate, phase plausibility rule and parser. Returns what the parser would do. */
function decide(combined: Combined, meanings: PhraseSet["meanings"], speechMs: number, gateBare: boolean, c: GrammarContext, sim: { phase: VoicePhase; turn: number; mine: boolean },
  applySim: (move: { kind: "phase"; phase: VoicePhase } | { kind: "turn" }) => void): { intent: VoiceIntent; note: string } {
  let intent: VoiceIntent = { kind: "none" }; let note = "";
  if (combined.canonical) {
    if (gateBare && isChatter(combined, meanings, speechMs)) note = `ignored: bare word in a ${(speechMs / 1000).toFixed(1)} s utterance`;
    else {
      // A phase word that makes no sense from the current phase is table talk: do nothing, leave a quiet note.
      const heardPhase = heardPhaseOf(combined.canonical);
      const verdict = heardPhase ? judgePhaseWord(sim.phase, sim.turn, sim.mine, heardPhase) : null;
      if (heardPhase && verdict && !verdict.accept) note = `Heard '${combined.canonical}', ${verdict.reason}, ignored`;
      else {
        intent = interpret(combined.canonical, c);
        if (verdict?.accept) applySim(verdict.move);
      }
    }
  }
  if (combined.ambiguous.length) note = [note, combined.ambiguous.map(a => `ambiguous: ${a.names.join(" or ")}`).join("; ")].filter(Boolean).join("; ");
  return { intent, note };
}

const HEARD_LABEL: Record<HeardPhase, string> = { draw: "draw phase", standby: "standby", main: "main / main phase", main1: "main one", battle: "battle / battle phase", main2: "main two", end: "end / end phase", endTurn: "end turn / pass" };
/** The phase a heard word names, to mark the row that matches where the table is now. */
const HEARD_TARGET: Partial<Record<HeardPhase, VoicePhase>> = { draw: "draw", standby: "standby", main1: "main1", battle: "battle", main2: "main2", end: "end" };

export function VoiceCheck() {
  const [text, setText] = useState("Kashtira Fenrir\nKashtira Unicorn\nApophis the Dark\nBlue-Eyes White Dragon\nGhost Belle & Haunted Mansion\nNumber 39: Utopia");
  const [decks, setDecks] = useState<SavedDeck[]>([]);
  const [deckNote, setDeckNote] = useState("");
  const [boost, setBoost] = useState(DEFAULT_PHRASE_OPTIONS.boost);
  const [nameBoost, setNameBoost] = useState(DEFAULT_PHRASE_OPTIONS.nameBoost);
  const [nameShift, setNameShift] = useState(DEFAULT_PHRASE_OPTIONS.nameShift);
  const [listFilter, setListFilter] = useState("");
  const [shift, setShift] = useState(DEFAULT_PHRASE_OPTIONS.thresholdShift);
  const [trayOpen, setTrayOpen] = useState(false);
  const [method, setMethod] = useState<Method>("asr");
  const [status, setStatus] = useState<"off" | "loading" | "listening">("off");
  const [ready, setReady] = useState<KwsReady | null>(null);
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [busyTotal, setBusyTotal] = useState({ busy: 0, audio: 0 });
  const [simPhase, setSimPhase] = useState<VoicePhase>("main1");
  const [simTurn, setSimTurn] = useState(2);
  const [simMine, setSimMine] = useState(true);
  const [mics, setMics] = useState<{ deviceId: string; label: string }[]>([]);
  const [micId, setMicId] = useState("");
  const [micStatus, setMicStatus] = useState<KwsStatus | null>(null);
  const [chatLeft, setChatLeft] = useState<number | null>(null);
  const [chat, setChat] = useState({ utterances: 0, hits: 0, acts: 0 });
  const client = useRef<KwsClient | null>(null);
  const rowSeq = useRef(0);
  const meaningsRef = useRef<PhraseSet["meanings"]>(new Map());
  const names = useMemo(() => [...new Set(text.split("\n").map(line => line.trim()).filter(Boolean))], [text]);
  const set = useMemo(() => buildPhrases(names, sp, { boost, thresholdShift: shift, nameBoost, nameShift }), [names, boost, shift, nameBoost, nameShift]);
  const lines = useMemo(() => set.lines.join("/"), [set]);
  const ctx = useMemo<GrammarContext>(() => ({ state: fixture(names, simPhase, simTurn), players: PLAYERS, me: 0, trayOpen, cardNames: names, now: 1100 }), [names, trayOpen, simPhase, simTurn]);
  const sim = useMemo(() => ({ phase: simPhase, turn: simTurn, mine: simMine }), [simPhase, simTurn, simMine]);
  const matcher = useMemo(() => (method === "asr" ? buildMatcher(names) : null), [method, names]);
  const live = useRef({ ctx, set, chatLeft, sim, matcher }); live.current = { ctx, set, chatLeft, sim, matcher };
  meaningsRef.current = set.meanings;

  useEffect(() => { client.current?.setKeywords(lines); }, [lines]);
  useEffect(() => () => client.current?.stop(), []);
  useEffect(() => {
    try { setMicId(localStorage.getItem(MIC_KEY) ?? ""); const saved = localStorage.getItem(METHOD_KEY); if (saved === "kws" || saved === "asr") setMethod(saved); } catch { /* private window: default mic and method */ }
  }, []);
  useEffect(() => {
    const list = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMics(devices.filter(d => d.kind === "audioinput" && d.deviceId).map((d, index) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${index + 1}` })));
      } catch { setMics([]); }
    };
    void list();
    navigator.mediaDevices?.addEventListener?.("devicechange", list);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", list);
  }, [status]);
  useEffect(() => {
    if (chatLeft === null) return;
    if (chatLeft <= 0) { setChatLeft(null); return; }
    const timer = setTimeout(() => setChatLeft(left => (left === null ? null : left - 1000)), 1000);
    return () => clearTimeout(timer);
  }, [chatLeft]);

  const applySim = (move: { kind: "phase"; phase: VoicePhase } | { kind: "turn" }) => {
    if (move.kind === "phase") setSimPhase(move.phase);
    else { setSimPhase("draw"); setSimTurn(turn => turn + 1); }
  };
  const onUtterance = useCallback((u: KwsUtterance) => {
    const { ctx: c, set: s, chatLeft: left, sim: simNow, matcher: m } = live.current;
    setBusyTotal(total => ({ busy: total.busy + u.busyMs, audio: total.audio + u.audioMs }));
    let combined: Combined; let heard: string; let tags: string; let gateBare = true; let extra = "";
    let matched = false;
    if (m && u.text !== undefined) {
      // Method B: transcript -> grammar matcher -> the same Combined shape the keyword path makes.
      const r = m.match(u.text, u.speechMs);
      combined = { canonical: r.canonical, tags: [], heard: [u.text], ambiguous: r.ambiguous.map(names => ({ spoken: r.spoken ?? "", names })) };
      heard = u.text || "(nothing heard)"; gateBare = false;
      matched = !!r.canonical || r.ambiguous.length > 0;
      tags = matched ? `${r.score.toFixed(2)}${r.runnerUp !== undefined ? ` (next ${r.runnerUp.toFixed(2)})` : ""}` : "no match";
      if (u.passes && u.passes > 1) extra = "retry pass used";
    } else {
      const hits = u.hits.filter(hit => hit.keyword !== "_");
      combined = combineHits(hits, s.meanings);
      heard = combined.heard.join(" + ") || "(no keyword)"; tags = combined.tags.join(" "); matched = hits.length > 0;
    }
    const { intent, note: decided } = decide(combined, s.meanings, u.speechMs, gateBare, c, simNow, applySim);
    const note = [decided, extra].filter(Boolean).join("; ");
    const acts = intent.kind !== "none" && intent.kind !== "name";
    if (left !== null) setChat(counts => ({ utterances: counts.utterances + 1, hits: counts.hits + (matched ? 1 : 0), acts: counts.acts + (acts ? 1 : 0) }));
    // Method A lists only utterances with a keyword hit; Method B lists every transcript so the misses can be read.
    if (!matched && !(m && u.text !== undefined) && left === null) return;
    const id = ++rowSeq.current;
    setRows(old => [{ id, method: (m ? "asr" : "kws") as Method, at: new Date().toLocaleTimeString(), heard, tags, canonical: combined.canonical,
      intent: describe(intent), acts, note, busyMs: u.busyMs, audioMs: u.audioMs, speechMs: u.speechMs }, ...old].slice(0, 200));
  }, []);

  const loadDecks = async () => {
    setDeckNote("Loading...");
    try {
      const response = await fetch("/api/decks");
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in first (this page is public, the decks are not)." : `HTTP ${response.status}`);
      const body = await response.json() as { decks?: SavedDeck[] };
      setDecks(body.decks ?? []); setDeckNote(`${body.decks?.length ?? 0} saved decks`);
    } catch (e) { setDeckNote((e as Error).message); }
  };
  const pickDeck = async (id: number) => {
    const deck = decks.find(entry => entry.id === id); if (!deck) return;
    const ids = [...new Set([...deck.deck.main, ...deck.deck.extra, ...deck.deck.side])];
    setDeckNote("Loading card names...");
    await loadCards(ids);
    setText(ids.map(code => cardInfo(code)?.name).filter((n): n is string => !!n).join("\n"));
    setDeckNote(`${deck.name}: ${ids.length} cards`);
  };

  const start = (deviceId = micId, which: Method = method) => {
    setError(""); setReady(null); setMicStatus(null); setStatus("loading");
    const kws = new KwsClient({
      ...(which === "asr" ? { base: ASR_BASE } : {}),
      deviceId: deviceId || undefined, onStatus: setMicStatus,
      defaultKeywords: placeholderLine(sp), keywords: lines, boost: 1.5, threshold: 0.25,
      onReady: info => { setReady(info); setStatus("listening"); },
      onUtterance, onLevel: value => setLevel(value),
      onError: message => { setError(message); },
    });
    client.current = kws;
    void kws.start();
  };
  const stop = () => { client.current?.stop(); client.current = null; setStatus("off"); setLevel(0); setChatLeft(null); setMicStatus(null); };
  const pickMic = (deviceId: string) => {
    setMicId(deviceId);
    try { localStorage.setItem(MIC_KEY, deviceId); } catch { /* the choice just is not remembered */ }
    if (client.current) { stop(); start(deviceId); }
  };
  const pickMethod = (next: Method) => {
    if (next === method) return;
    setMethod(next);
    try { localStorage.setItem(METHOD_KEY, next); } catch { /* the choice just is not remembered */ }
    if (client.current) { stop(); start(micId, next); }
  };
  const micName = micStatus?.micName ?? "the microphone";
  const micProblem = !micStatus ? "" : micStatus.contextState !== "running" ? "Click anywhere to start audio"
    : micStatus.muted || micStatus.silentMs > NO_SOUND_MS ? `No sound from ${micName}. Pick another microphone or check Windows sound settings.` : "";
  const startChat = () => { setChat({ utterances: 0, hits: 0, acts: 0 }); setChatLeft(CHAT_MS); };

  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const cpu = busyTotal.audio ? busyTotal.busy / busyTotal.audio : 0;
  const cell = { border: "1px solid #444", padding: "2px 6px", textAlign: "left" as const, verticalAlign: "top" as const };
  return (
    <main style={{ padding: 20, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui, sans-serif", color: "#eee", background: "#111", minHeight: "100vh" }} data-testid="voice-check">
      <style>{`[data-testid="voice-check"] button{padding:8px 16px;margin:2px 6px 2px 0;border:1px solid #8ab4f8;border-radius:6px;background:#1a3a6b;color:#fff;font-weight:600;cursor:pointer}[data-testid="voice-check"] button:disabled{opacity:.45;cursor:not-allowed}[data-testid="voice-check"] button:hover:not(:disabled){background:#25508f}`}</style>
      <h1 style={{ fontSize: 22 }}>Voice command check</h1>
      <p style={{ opacity: 0.8 }}>Two ways to hear commands, in this page only. Keywords (old): sherpa-onnx keyword spotting in a worker. Speech model (new): Moonshine Tiny q8 turns each gated utterance into text (onnxruntime-web, WASM, one thread), then a grammar matcher picks the command or card. Audio never leaves the page; only the model files are downloaded. Not wired to any table.</p>
      <section style={{ display: "grid", gap: 8 }}>
        <div data-testid="method" role="radiogroup" aria-label="Method" style={{ border: "1px solid #444", borderRadius: 6, padding: 8 }}>
          <b>Method</b>{" "}
          <label><input type="radio" name="method" checked={method === "kws"} onChange={() => pickMethod("kws")} data-testid="method-kws" /> Keywords (old)</label>{" "}
          <label><input type="radio" name="method" checked={method === "asr"} onChange={() => pickMethod("asr")} data-testid="method-asr" /> Speech model (new)</label>
          {status !== "off" && <span style={{ opacity: 0.7 }}> (switching restarts the listener)</span>}
        </div>
        <label>Deck card names (one per line, or pick a saved deck)
          <textarea value={text} onChange={e => setText(e.target.value)} rows={8} style={{ width: "100%", background: "#1c1c1c", color: "#eee" }} data-testid="names" />
        </label>
        <div>
          <button onClick={loadDecks}>Load my saved decks</button>{" "}
          <select onChange={e => void pickDeck(Number(e.target.value))} defaultValue=""><option value="" disabled>Saved deck...</option>{decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>{" "}
          <span>{deckNote}</span>
        </div>
        {method === "kws" && <div>
          <label>Boost {boost.toFixed(1)} <input type="range" min={0} max={4} step={0.1} value={boost} onChange={e => setBoost(Number(e.target.value))} /></label>{" "}
          <label>Threshold shift {shift >= 0 ? "+" : ""}{shift.toFixed(2)} <input type="range" min={-0.4} max={0.4} step={0.05} value={shift} onChange={e => setShift(Number(e.target.value))} /></label>{" "}
          <label>Name boost {nameBoost >= 0 ? "+" : ""}{nameBoost.toFixed(1)} <input type="range" min={-1} max={2} step={0.1} value={nameBoost} onChange={e => setNameBoost(Number(e.target.value))} /></label>{" "}
          <label>Name threshold shift {nameShift >= 0 ? "+" : ""}{nameShift.toFixed(2)} <input type="range" min={-0.2} max={0.4} step={0.05} value={nameShift} onChange={e => setNameShift(Number(e.target.value))} /></label>{" "}
        </div>}
        <div><label><input type="checkbox" checked={trayOpen} onChange={e => setTrayOpen(e.target.checked)} /> card tray open</label></div>
        <div data-testid="phase-sim" style={{ border: "1px solid #444", borderRadius: 6, padding: 8 }}>
          <b>Phase simulator</b> (spoken phase words are judged against this; an accepted word moves it)<br />
          Current phase: <b data-testid="sim-phase" style={{ color: "#e0b050" }}>{PHASE_LABEL[simPhase]}</b>{" "}
          {VOICE_PHASES.map(phase => <button key={phase} onClick={() => setSimPhase(phase)} style={phase === simPhase ? { background: "#6b4a1a", borderColor: "#e0b050" } : undefined}>{PHASE_LABEL[phase]}</button>)}<br />
          <label>Turn <input type="number" min={1} value={simTurn} onChange={e => setSimTurn(Math.max(1, Number(e.target.value) || 1))} style={{ width: 56 }} /></label>{" "}
          <label><input type="checkbox" checked={simMine} onChange={e => setSimMine(e.target.checked)} /> I am the turn player</label>
          <table style={{ borderCollapse: "collapse", marginTop: 6, fontSize: 13 }} data-testid="sim-table">
            <thead><tr><th style={cell}>Heard (now in {PHASE_LABEL[simPhase]}, turn {simTurn})</th><th style={cell}>Result</th></tr></thead>
            <tbody>{HEARD_PHASES.map(heard => {
              const verdict = judgePhaseWord(simPhase, simTurn, simMine, heard);
              return <tr key={heard} style={HEARD_TARGET[heard] === simPhase ? { background: "#2a2414" } : undefined}><td style={cell}>{HEARD_LABEL[heard]}{HEARD_TARGET[heard] === simPhase ? " (current phase)" : ""}</td>
                <td style={{ ...cell, color: verdict.accept ? "#8c6" : "#aaa" }}>{verdict.accept ? `accept: ${verdict.move.kind === "turn" ? "end the turn" : `go to ${PHASE_LABEL[verdict.move.phase]}`}` : `ignore: ${verdict.reason}`}</td></tr>;
            })}</tbody>
          </table>
        </div>
        {method === "kws" && <><div data-testid="phrase-counts">
          {set.lines.length} phrases: {set.counts.fixed} fixed, {set.counts.fullNames} full names, {set.counts.runs} word runs, {set.counts.words} one-word partials, {set.counts.ambiguous} shared by 2+ cards
          {set.counts.skipped.length ? `, skipped ${set.counts.skipped.length}: ${set.counts.skipped.slice(0, 5).join(", ")}` : ""}
        </div>
        <details data-testid="keyword-list">
          <summary>Keyword list sent to the model ({set.entries.length} phrases: what can be heard, with tokens, boost and threshold)</summary>
          <input value={listFilter} onChange={e => setListFilter(e.target.value)} placeholder="filter, for example fenrir" style={{ width: 260, margin: "6px 0", background: "#1c1c1c", color: "#eee" }} />
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
              <thead><tr><th style={cell}>Kind</th><th style={cell}>Spoken</th><th style={cell}>Tokens</th><th style={cell}>Boost</th><th style={cell}>Thr</th><th style={cell}>Card</th></tr></thead>
              <tbody>{set.entries.filter(e => !listFilter || `${e.spoken} ${e.names?.join(" ") ?? ""}`.toLowerCase().includes(listFilter.toLowerCase())).slice(0, 400).map(e => (
                <tr key={e.tag}><td style={cell}>{e.kind}</td><td style={cell}>{e.spoken.toLowerCase()}</td><td style={cell}>{e.tokens.join(" ")}</td><td style={cell}>{e.boost}</td><td style={cell}>{e.threshold}</td>
                  <td style={cell}>{e.names ? (e.names.length > 1 ? `${e.names.length} cards: ` : "") + e.names.join(" | ") : ""}</td></tr>))}</tbody>
            </table>
          </div>
        </details></>}
        <div>
          {status === "off" ? <button onClick={() => start()} data-testid="start">Start</button> : <button onClick={stop}>Stop</button>}{" "}
          <span data-testid="status">{status}</span>{" "}
          <span style={{ display: "inline-block", width: 120, height: 10, background: "#333", verticalAlign: "middle" }}><span style={{ display: "block", height: 10, width: `${Math.round(level * 100)}%`, background: "#8c6" }} /></span>
          {error && <span style={{ color: "#f88" }} data-testid="error"> {error}</span>}
        </div>
        <div>
          <label>Microphone <select value={micId} onChange={e => pickMic(e.target.value)} data-testid="mic">
            <option value="">Default</option>
            {micId && !mics.some(m => m.deviceId === micId) && <option value={micId}>Saved microphone (not found)</option>}
            {mics.map(m => <option key={m.deviceId} value={m.deviceId}>{m.label}</option>)}
          </select></label>
        </div>
        {micStatus && <div data-testid="mic-status" style={{ fontSize: 13 }}>
          Mic: {micStatus.micName} | AudioContext: {micStatus.contextState} | {micStatus.sampleRate} Hz | track {micStatus.muted ? "MUTED" : "live"}, {micStatus.enabled ? "enabled" : "disabled"} | frames/s: {micStatus.framesPerSecond.toFixed(0)} (about 50 expected)
        </div>}
        {micProblem && <div data-testid="mic-problem" role="status" style={{ color: "#fc8", border: "1px solid #a82", padding: "4px 8px", borderRadius: 6 }}>{micProblem}</div>}
        {ready && <div data-testid="load">{method === "asr" ? "Speech model (Moonshine Tiny q8)" : "Keyword model"} first load {(ready.totalMs / 1000).toFixed(2)} s (files {(ready.fetchMs / 1000).toFixed(2)} s, init {(ready.initMs / 1000).toFixed(2)} s), model size {(ready.bytes / 1e6).toFixed(1)} MB{ready.heapBytes ? `, wasm heap ${(ready.heapBytes / 1e6).toFixed(0)} MB` : ""}{ready.accepted ? "" : " - the spotter rejected the phrase list"}</div>}
        <div data-testid="cpu">Speech worker busy time / audio time: {cpu.toFixed(3)} ({(busyTotal.busy / 1000).toFixed(2)} s for {(busyTotal.audio / 1000).toFixed(1)} s of gated audio)</div>
        <div>
          10-minute chat test: {chatLeft === null ? <button onClick={startChat} disabled={status !== "listening"} data-testid="chat-start">Start chat test</button> : <><b data-testid="chat-timer">{mmss(chatLeft)}</b> <button onClick={() => setChatLeft(null)}>End</button></>}{" "}
          <span data-testid="false-count">Utterances {chat.utterances}, with a keyword hit {chat.hits}, <b>false triggers (the parser would act) {chat.acts}</b></span> (pass: at most 1 in 10 minutes)
        </div>
      </section>
      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 12, fontSize: 13 }} data-testid="rows">
        <thead><tr><th style={cell}>Time</th><th style={cell}>Method</th><th style={cell}>Heard (keyword hit / transcript)</th><th style={cell}>Tag / match score</th><th style={cell}>Canonical text</th><th style={cell}>Parser would</th><th style={cell}>Note</th><th style={cell}>Busy / audio ms</th></tr></thead>
        <tbody>{rows.map(row => (
          <tr key={row.id} style={{ background: row.acts ? "#2a2a14" : undefined }}>
            <td style={cell}>{row.at}</td><td style={cell}>{row.method === "asr" ? "Speech model" : "Keywords"}</td><td style={cell}>{row.heard}</td><td style={cell}>{row.tags}</td><td style={cell}>{row.canonical || "-"}</td>
            <td style={cell}><b>{row.intent}</b></td><td style={cell}>{row.note}</td><td style={cell} data-testid="row-busy">{Math.round(row.busyMs)} / {Math.round(row.audioMs)}</td>
          </tr>))}</tbody>
      </table>
    </main>
  );
}
