"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ygoModule, remoteActionSchema, type RemoteState } from "@yugidraft/shared/remote";
import { interpret, type GrammarContext, type VoiceIntent } from "@/components/remote/ui/grammar";
import { cardInfo, loadCards } from "@/components/remote/ui/catalog";
import { createSentencePiece, type SentencePieceVocab } from "@/components/remote/ui/voice/sentencepiece";
import { buildPhrases, combineHits, isChatter, placeholderLine, type Combined, type PhraseSet } from "@/components/remote/ui/voice/phrases";
import { KwsClient, type KwsReady, type KwsUtterance } from "@/components/remote/ui/voice/kws-client";
import vocab from "@/components/remote/ui/voice/sp-vocab.json";

const sp = createSentencePiece(vocab as SentencePieceVocab);
const CHAT_MS = 10 * 60 * 1000;
const PLAYERS = [{ seat: 0, displayName: "Me" }, { seat: 1, displayName: "Opponent" }];

type Row = { id: number; at: string; heard: string; tags: string; canonical: string; intent: string; acts: boolean; note: string; busyMs: number; audioMs: number; speechMs: number };
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
function fixture(names: string[]): RemoteState {
  let state = { ...ygoModule.initialState({ seatCount: 2 }), turn: 2, phase: "main1" } as RemoteState;
  try {
    names.slice(0, 4).forEach((name, index) => {
      state = ygoModule.reduce(state, remoteActionSchema.parse({ type: "twin.place", actorSeat: index % 2, seat: index % 2, zone: "monster", at: 1000 + index,
        idempotencyKey: `voice-check-${index}`, card: { ref: `fx-${index}`, name, slot: Math.floor(index / 2) + 1, faceUp: true, position: "attack" } }));
    });
  } catch { /* an odd name only loses the fixture field */ }
  return state;
}

export function VoiceCheck() {
  const [text, setText] = useState("Kashtira Fenrir\nKashtira Unicorn\nApophis the Dark\nBlue-Eyes White Dragon\nGhost Belle & Haunted Mansion\nNumber 39: Utopia");
  const [decks, setDecks] = useState<SavedDeck[]>([]);
  const [deckNote, setDeckNote] = useState("");
  const [boost, setBoost] = useState(1.5);
  const [shift, setShift] = useState(0);
  const [trayOpen, setTrayOpen] = useState(false);
  const [status, setStatus] = useState<"off" | "loading" | "listening">("off");
  const [ready, setReady] = useState<KwsReady | null>(null);
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [busyTotal, setBusyTotal] = useState({ busy: 0, audio: 0 });
  const [chatLeft, setChatLeft] = useState<number | null>(null);
  const [chat, setChat] = useState({ utterances: 0, hits: 0, acts: 0 });
  const client = useRef<KwsClient | null>(null);
  const meaningsRef = useRef<PhraseSet["meanings"]>(new Map());
  const names = useMemo(() => [...new Set(text.split("\n").map(line => line.trim()).filter(Boolean))], [text]);
  const set = useMemo(() => buildPhrases(names, sp, { boost, thresholdShift: shift }), [names, boost, shift]);
  const lines = useMemo(() => set.lines.join("/"), [set]);
  const ctx = useMemo<GrammarContext>(() => ({ state: fixture(names), players: PLAYERS, me: 0, trayOpen, cardNames: names, now: 1100 }), [names, trayOpen]);
  const live = useRef({ ctx, set, chatLeft }); live.current = { ctx, set, chatLeft };
  meaningsRef.current = set.meanings;

  useEffect(() => { client.current?.setKeywords(lines); }, [lines]);
  useEffect(() => () => client.current?.stop(), []);
  useEffect(() => {
    if (chatLeft === null) return;
    if (chatLeft <= 0) { setChatLeft(null); return; }
    const timer = setTimeout(() => setChatLeft(left => (left === null ? null : left - 1000)), 1000);
    return () => clearTimeout(timer);
  }, [chatLeft]);

  const onUtterance = useCallback((u: KwsUtterance) => {
    const { ctx: c, set: s, chatLeft: left } = live.current;
    setBusyTotal(total => ({ busy: total.busy + u.busyMs, audio: total.audio + u.audioMs }));
    const hits = u.hits.filter(hit => hit.keyword !== "_");
    const combined: Combined = combineHits(hits, s.meanings);
    let intent: VoiceIntent = { kind: "none" }; let note = "";
    if (combined.canonical) {
      if (isChatter(combined, s.meanings, u.speechMs)) note = `ignored: bare word in a ${(u.speechMs / 1000).toFixed(1)} s utterance`;
      else intent = interpret(combined.canonical, c);
    }
    if (combined.ambiguous.length) note = [note, `ambiguous: ${combined.ambiguous.map(a => `${a.spoken} = ${a.names.join(" | ")}`).join("; ")}`].filter(Boolean).join("; ");
    const acts = intent.kind !== "none" && intent.kind !== "name";
    if (left !== null) setChat(counts => ({ utterances: counts.utterances + 1, hits: counts.hits + (hits.length ? 1 : 0), acts: counts.acts + (acts ? 1 : 0) }));
    if (!hits.length && left === null) return;
    setRows(old => [{ id: u.id, at: new Date().toLocaleTimeString(), heard: combined.heard.join(" + ") || "(no keyword)", tags: combined.tags.join(" "), canonical: combined.canonical,
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

  const start = () => {
    setError(""); setReady(null); setStatus("loading");
    const kws = new KwsClient({
      defaultKeywords: placeholderLine(sp), keywords: lines, boost: 1.5, threshold: 0.25,
      onReady: info => { setReady(info); setStatus("listening"); },
      onUtterance, onLevel: value => setLevel(value),
      onError: message => { setError(message); },
    });
    client.current = kws;
    void kws.start();
  };
  const stop = () => { client.current?.stop(); client.current = null; setStatus("off"); setLevel(0); setChatLeft(null); };
  const startChat = () => { setChat({ utterances: 0, hits: 0, acts: 0 }); setChatLeft(CHAT_MS); };

  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const cpu = busyTotal.audio ? busyTotal.busy / busyTotal.audio : 0;
  const cell = { border: "1px solid #444", padding: "2px 6px", textAlign: "left" as const, verticalAlign: "top" as const };
  return (
    <main style={{ padding: 20, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui, sans-serif", color: "#eee", background: "#111", minHeight: "100vh" }} data-testid="voice-check">
      <style>{`[data-testid="voice-check"] button{padding:8px 16px;margin:2px 6px 2px 0;border:1px solid #8ab4f8;border-radius:6px;background:#1a3a6b;color:#fff;font-weight:600;cursor:pointer}[data-testid="voice-check"] button:disabled{opacity:.45;cursor:not-allowed}[data-testid="voice-check"] button:hover:not(:disabled){background:#25508f}`}</style>
      <h1 style={{ fontSize: 22 }}>Voice command check</h1>
      <p style={{ opacity: 0.8 }}>Keyword spotting in this page only (sherpa-onnx WASM in a worker). Audio never leaves the page; only the model files are downloaded. Not wired to any table.</p>
      <section style={{ display: "grid", gap: 8 }}>
        <label>Deck card names (one per line, or pick a saved deck)
          <textarea value={text} onChange={e => setText(e.target.value)} rows={8} style={{ width: "100%", background: "#1c1c1c", color: "#eee" }} data-testid="names" />
        </label>
        <div>
          <button onClick={loadDecks}>Load my saved decks</button>{" "}
          <select onChange={e => void pickDeck(Number(e.target.value))} defaultValue=""><option value="" disabled>Saved deck...</option>{decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>{" "}
          <span>{deckNote}</span>
        </div>
        <div>
          <label>Boost {boost.toFixed(1)} <input type="range" min={0.5} max={4} step={0.1} value={boost} onChange={e => setBoost(Number(e.target.value))} /></label>{" "}
          <label>Threshold shift {shift >= 0 ? "+" : ""}{shift.toFixed(2)} <input type="range" min={-0.2} max={0.4} step={0.05} value={shift} onChange={e => setShift(Number(e.target.value))} /></label>{" "}
          <label><input type="checkbox" checked={trayOpen} onChange={e => setTrayOpen(e.target.checked)} /> card tray open</label>
        </div>
        <div data-testid="phrase-counts">
          {set.lines.length} phrases: {set.counts.fixed} fixed, {set.counts.fullNames} full names, {set.counts.runs} word runs, {set.counts.words} one-word partials, {set.counts.ambiguous} shared by 2+ cards
          {set.counts.skipped.length ? `, skipped ${set.counts.skipped.length}: ${set.counts.skipped.slice(0, 5).join(", ")}` : ""}
        </div>
        <div>
          {status === "off" ? <button onClick={start} data-testid="start">Start</button> : <button onClick={stop}>Stop</button>}{" "}
          <span data-testid="status">{status}</span>{" "}
          <span style={{ display: "inline-block", width: 120, height: 10, background: "#333", verticalAlign: "middle" }}><span style={{ display: "block", height: 10, width: `${Math.round(level * 100)}%`, background: "#8c6" }} /></span>
          {error && <span style={{ color: "#f88" }} data-testid="error"> {error}</span>}
        </div>
        {ready && <div data-testid="load">Model loaded in {(ready.totalMs / 1000).toFixed(2)} s (files {(ready.fetchMs / 1000).toFixed(2)} s, init {(ready.initMs / 1000).toFixed(2)} s, {(ready.bytes / 1e6).toFixed(1)} MB model, wasm heap {(ready.heapBytes / 1e6).toFixed(0)} MB){ready.accepted ? "" : " - the spotter rejected the phrase list"}</div>}
        <div data-testid="cpu">Speech worker busy time / audio time: {cpu.toFixed(3)} ({(busyTotal.busy / 1000).toFixed(2)} s for {(busyTotal.audio / 1000).toFixed(1)} s of gated audio)</div>
        <div>
          10-minute chat test: {chatLeft === null ? <button onClick={startChat} disabled={status !== "listening"} data-testid="chat-start">Start chat test</button> : <><b data-testid="chat-timer">{mmss(chatLeft)}</b> <button onClick={() => setChatLeft(null)}>End</button></>}{" "}
          <span data-testid="false-count">Utterances {chat.utterances}, with a keyword hit {chat.hits}, <b>false triggers (the parser would act) {chat.acts}</b></span> (pass: at most 1 in 10 minutes)
        </div>
      </section>
      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 12, fontSize: 13 }} data-testid="rows">
        <thead><tr><th style={cell}>Time</th><th style={cell}>Keyword hit</th><th style={cell}>Tag</th><th style={cell}>Canonical text</th><th style={cell}>Parser would</th><th style={cell}>Note</th><th style={cell}>Busy / audio ms</th></tr></thead>
        <tbody>{rows.map(row => (
          <tr key={row.id} style={{ background: row.acts ? "#2a2a14" : undefined }}>
            <td style={cell}>{row.at}</td><td style={cell}>{row.heard}</td><td style={cell}>{row.tags}</td><td style={cell}>{row.canonical || "-"}</td>
            <td style={cell}><b>{row.intent}</b></td><td style={cell}>{row.note}</td><td style={cell}>{Math.round(row.busyMs)} / {Math.round(row.audioMs)}</td>
          </tr>))}</tbody>
      </table>
    </main>
  );
}
