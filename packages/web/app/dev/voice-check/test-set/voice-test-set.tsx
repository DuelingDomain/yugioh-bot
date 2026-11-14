"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createTestSet, scriptSummary } from "@/components/remote/ui/voice/test-set/script";
import { decodeWav, encodeWav, exportTestSet, importTestSet } from "@/components/remote/ui/voice/test-set/format";
import { loadSession, saveSession } from "@/components/remote/ui/voice/test-set/storage";
import { recordMicrophone, type Recording } from "@/components/remote/ui/voice/test-set/recorder";
import { checkAssets, METHOD_IDS, METHODS, replay, type RunResult } from "@/components/remote/ui/voice/test-set/replay";
import { METRICS_NOTE, VoiceMeasurements } from "../metrics";
import { errorText, intentKey, type Method, type TestSet } from "@/components/remote/ui/voice/test-set/model";

const cell = { border: "1px solid #444", padding: "5px 8px", textAlign: "left" as const, verticalAlign: "top" };
const percent = (n: number | null) => n === null ? "—" : `${(n * 100).toFixed(1)}%`;
const number = (n: number | null, digits = 1) => n === null ? "—" : n.toFixed(digits);
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function AudioPreview({ pcm }: { pcm: Float32Array }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const value = URL.createObjectURL(new Blob([encodeWav(pcm)], { type: "audio/wav" })); setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [pcm]);
  return url ? <audio controls src={url} preload="none" /> : null;
}

export function VoiceTestSet() {
  const [session, setSession] = useState<TestSet | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("Loading local session…");
  const [busy, setBusy] = useState<"idle" | "saving" | "opening-mic" | "recording" | "replaying">("idle");
  const [progress, setProgress] = useState(""); const [level, setLevel] = useState(0);
  const [assetRevision, setAssetRevision] = useState(0);
  const [assets, setAssets] = useState<Partial<Record<Method, string>>>({});
  const [method, setMethod] = useState<Method>("asr"); const [runs, setRuns] = useState<RunResult[]>([]);
  const recording = useRef<Recording | null>(null); const operation = useRef<AbortController | null>(null);
  const initialized = useRef(false); const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (!initialized.current) {
      initialized.current = true;
      void loadSession().then(saved => { if (mounted.current) { setSession(saved ?? createTestSet()); setNotice(saved ? "Resumed local session." : "New local session. Record a prompt to save it."); } }).catch(e => {
        if (mounted.current) { setSession(createTestSet()); setError(`Local storage unavailable: ${errorText(e)}. Export before leaving.`); }
      });
    }
    return () => { mounted.current = false; operation.current?.abort(); recording.current?.cancel(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController(); setAssets({});
    for (const candidate of METHOD_IDS) void checkAssets(candidate, controller.signal).then(message => {
      if (!controller.signal.aborted) setAssets(old => ({ ...old, [candidate]: message ?? "Local assets available" }));
    }).catch(e => { if (!controller.signal.aborted) setAssets(old => ({ ...old, [candidate]: `Asset check failed: ${errorText(e)}` })); });
    return () => controller.abort();
  }, [assetRevision]);

  const persist = async (next: TestSet, message: string) => {
    setSession(next); setBusy("saving");
    try { await saveSession(next); setNotice(message); }
    catch (e) { setError(`Local save failed: ${errorText(e)}. The session remains in memory; use Export.`); }
    finally { if (mounted.current) setBusy("idle"); }
  };
  if (!session) return <main style={{ padding: 24 }}><p>{notice}</p>{error && <p role="alert">{error}</p>}</main>;
  const summary = scriptSummary(session.prompts); const prompt = session.prompts[session.cursor];
  const clip = prompt && session.clips.find(c => c.promptId === prompt.id);
  const disabled = busy !== "idle";
  const changeCursor = (cursor: number) => { void persist({ ...session, cursor }, "Position saved. You can leave and resume later."); };
  const capture = async () => {
    if (!prompt) return;
    const snapshot = session; const current = prompt; const controller = new AbortController(); operation.current = controller;
    setError(""); setProgress("Requesting microphone…"); setBusy("opening-mic");
    try {
      const take = await recordMicrophone(current.targetMs, (ms, rms) => {
        if (mounted.current) { setProgress(`${seconds(ms)} / ${seconds(current.targetMs)}`); setLevel(Math.min(1, rms * 8)); }
      }, controller.signal);
      recording.current = take;
      if (mounted.current) { setBusy("recording"); setProgress("Speak now"); }
      const pcm = decodeWav(encodeWav(await take.done));
      if (!mounted.current) return;
      setRuns([]);
      await persist({ ...snapshot, revision: snapshot.revision + 1,
        clips: [...snapshot.clips.filter(c => c.promptId !== current.id), { promptId: current.id, recordedAt: new Date().toISOString(), pcm }],
        skipped: snapshot.skipped.filter(id => id !== current.id) }, "Take saved. Listen, redo, or continue.");
    } catch (e) { if (mounted.current) { setError(errorText(e)); setBusy("idle"); } }
    finally { recording.current = null; operation.current = null; if (mounted.current) { setLevel(0); setProgress(""); } }
  };
  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob([exportTestSet(session)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `voice-test-set-${session.id}-r${session.revision}.json`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("Export download requested.");
    } catch (e) { setError(errorText(e)); }
  };
  const run = async () => {
    const controller = new AbortController(); operation.current = controller; setBusy("replaying"); setError(""); setProgress("Checking assets and loading worker…");
    try {
      const result = await replay(session, method, controller.signal, (done, total) => { if (mounted.current) setProgress(`Replayed ${done} / ${total} clips`); });
      if (mounted.current) { setRuns(old => [...old.filter(r => r.method !== method), result]); setNotice("Replay complete. Compare methods only on this corpus revision."); }
    } catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { operation.current = null; if (mounted.current) { setBusy("idle"); setProgress(""); } }
  };
  const ranked = [...runs].sort((a, b) => (b.scores.commandAccuracy ?? -1) - (a.scores.commandAccuracy ?? -1)
    || (a.scores.falseActivationRate ?? Infinity) - (b.scores.falseActivationRate ?? Infinity)
    || (a.scores.chatterActionsPerMinute ?? Infinity) - (b.scores.chatterActionsPerMinute ?? Infinity));

  return <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto", fontFamily: "system-ui", display: "grid", gap: 14 }}>
    <Link href="/dev/voice-check">← Voice command check</Link>
    <h1 style={{ fontSize: 22 }}>Real-audio voice test set</h1>
    <p>Record once, replay the same audio through every method. Audio and labels stay in this browser’s IndexedDB or your downloaded file. Nothing is uploaded. Replay reads existing local model assets; this tool does not install models.</p>
    <p>{summary.commands} command prompts, {summary.nearMisses} no-action prompts, {summary.chatter} chatter segment. Two repetitions of every finite phase/turn vocabulary phrase, shuffled. Audio budget: {(summary.expectedMs / 60000).toFixed(1)} minutes, plus button presses and redo time. Record starts immediately; speak when “Speak now” appears. Each short take stops automatically. Leave ordinary pauses during chatter.</p>
    <p>Corpus {session.id}, revision {session.revision}. Recorded {session.clips.length}/{session.prompts.length}; skipped {session.skipped.length}. Reload to resume. A redo replaces its previous take and clears comparisons.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      <button disabled={disabled} onClick={download}>Export audio + manifest</button>
      <label>Import file <input type="file" accept=".json,application/json" disabled={disabled} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        setBusy("saving"); setError("");
        try {
          if (file.size > 80_000_000) throw new Error("Import exceeds 80 MB");
          const imported = importTestSet(await file.text()); setRuns([]); await persist(imported, "Imported audio and resume state. Active local session replaced.");
        } catch (e) { setError(errorText(e)); setBusy("idle"); }
      }} /></label>
      <button disabled={disabled} onClick={() => { setRuns([]); setError(""); void persist(createTestSet(), "New shuffled session. Previous active session replaced."); }}>New session (replaces local session)</button>
    </div>
    <p role="status" aria-live="polite">{notice} {progress} {busy !== "idle" && `(${busy})`}</p>
    {error && <p role="alert" style={{ color: "#f88" }}>{error}</p>}
    <section style={{ border: "1px solid #444", padding: 12, display: "grid", gap: 10 }}>
      <label>Prompt <select disabled={disabled} value={session.cursor} onChange={event => changeCursor(Number(event.target.value))} style={{ maxWidth: "100%" }}>
        {session.prompts.map((p, index) => <option value={index} key={p.id}>{index + 1}. {session.clips.some(c => c.promptId === p.id) ? "✓" : session.skipped.includes(p.id) ? "skipped" : "○"} {p.phrase}</option>)}
        <option value={session.prompts.length}>Session end</option>
      </select></label>
      {prompt ? <>
        <div>{prompt.category} · expected {intentKey(prompt.expected)} · phase {prompt.sim.phase}, turn {prompt.sim.turn}, {prompt.sim.mine ? "your turn" : "opponent’s turn"} · {seconds(prompt.targetMs)}</div>
        <p style={{ fontSize: 24 }}><b>{prompt.phrase}</b></p>
        {prompt.note && <p>{prompt.note}</p>}
        <div><button disabled={disabled} onClick={() => void capture()}>{clip ? "Redo this prompt" : "Record prompt"}</button>{" "}
          {busy === "recording" && <button onClick={() => recording.current?.finish()}>Finish take early</button>}{" "}
          {(busy === "recording" || busy === "opening-mic") && <button onClick={() => operation.current?.abort()}>Cancel take</button>}
          <meter min={0} max={1} value={level} aria-label="Microphone level" />
        </div>
        {clip && <div><AudioPreview pcm={clip.pcm} /> Recorded {seconds(clip.pcm.length / 16)}</div>}
        <div><button disabled={disabled || session.cursor === 0} onClick={() => changeCursor(session.cursor - 1)}>Previous</button>{" "}
          <button disabled={disabled || !clip} onClick={() => changeCursor(session.cursor + 1)}>Keep & next</button>{" "}
          <button disabled={disabled || !!clip} onClick={() => void persist({ ...session, cursor: session.cursor + 1, skipped: [...new Set([...session.skipped, prompt.id])] }, "Prompt skipped. Select it later to record.")}>Skip</button></div>
      </> : <p>Script finished. Revisit skipped prompts using the selector, export, or replay the recorded clips.</p>}
    </section>
    <section style={{ display: "grid", gap: 8 }}>
      <h2>Replay and compare</h2>
      <div><button disabled={disabled} onClick={() => setAssetRevision(value => value + 1)}>Recheck assets</button></div>
      {METHOD_IDS.map(candidate => <div key={candidate}>{METHODS[candidate]}: {assets[candidate] ?? "Checking local assets…"}</div>)}
      <div><select aria-label="Replay method" value={method} disabled={disabled} onChange={event => { if (event.target.value === "asr" || event.target.value === "kws" || event.target.value === "two-stage") setMethod(event.target.value); }}>
        {METHOD_IDS.map(id => <option key={id} value={id}>{METHODS[id]}</option>)}
      </select>{" "}<button disabled={disabled || !session.clips.length || assets[method] !== "Local assets available"} onClick={() => void run()}>Replay recorded clips</button>{" "}
      {busy === "replaying" && <button onClick={() => operation.current?.abort()}>Cancel replay</button>}{" "}
      <button disabled={!runs.length || disabled} onClick={async () => {
        try { await navigator.clipboard.writeText(JSON.stringify(ranked, null, 2)); setNotice("Results JSON copied."); } catch (e) { setError(`Copy failed: ${errorText(e)}`); }
      }}>Copy results JSON</button></div>
      <p>Partial sets are allowed and counts are shown. Ranking: command accuracy, then fewer near-miss activations, then chatter actions/minute. No preferred method is assumed. Latency is the gate’s audio-clock silence tail plus elapsed wall time from submission to decision, including queue and first-hit model load. Replay feeds audio faster than real time: wall CPU describes this replay run; corpus CPU estimates busy time per second of recorded audio. Idle replay includes no-command near-miss/chatter clips. Record actual idle listening on the check page. Worker RTF = busy / gated audio (includes worker padding). Each utterance uses the item’s label state, without advancing it, to avoid suppressing subsequent false activations.</p>
      <p style={{ fontSize: 12 }}>{METRICS_NOTE}</p>
      <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr>{["Rank / method", "Command accuracy", "Near-miss false activations", "Chatter actions/min", "Decision mean / p95 ms", "CPU % of one core (S1 / S2, wall)", "CPU % (S1 / S2, recorded audio estimate)", "Utterances / clips"].map(title => <th style={cell} key={title}>{title}</th>)}</tr></thead>
        <tbody>{ranked.map((r, index) => <tr key={r.method}>
          <td style={cell}>{index + 1}. {METHODS[r.method]}</td><td style={cell}>{percent(r.scores.commandAccuracy)} ({r.scores.correctCommands}/{r.scores.commands})</td>
          <td style={cell}>{percent(r.scores.falseActivationRate)} ({r.scores.falseActivatedItems}/{r.scores.nearMissItems} items; {r.scores.nearMissActions} actions)</td>
          <td style={cell}>{number(r.scores.chatterActionsPerMinute)} ({r.scores.chatterActions} / {seconds(r.scores.chatterMs)})</td>
          <td style={cell}>{number(r.measurements.latency.meanMs)} / {number(r.measurements.latency.p95Ms)}</td>
          <td style={cell}>{number(r.measurements.stage1.cpu?.percent ?? null)} / {number(r.measurements.stage2.cpu?.percent ?? null)}</td>
          <td style={cell}>{number(r.recordedAudioCpu.stage1?.percent ?? null)} / {number(r.recordedAudioCpu.stage2?.percent ?? null)}</td><td style={cell}>{r.scores.utterances} / {r.recordedClips}</td>
        </tr>)}{METHOD_IDS.filter(id => !runs.some(run => run.method === id)).map(id => <tr key={id}><td style={cell}>{METHODS[id]}</td><td style={cell} colSpan={7}>{assets[id] === "Local assets available" ? "Not run on this corpus yet" : assets[id] ?? "Checking assets…"}</td></tr>)}</tbody>
      </table></div>
      {ranked.map(run => <details key={run.method}><summary>{METHODS[run.method]}: per-phrase accuracy and heard text / keyword hits for misses</summary>
        <VoiceMeasurements value={run.measurements} />
        <p>No-command corpus CPU estimate (S1 / S2): {number(run.idleRecordedAudioCpu.stage1?.percent ?? null)}% / {number(run.idleRecordedAudioCpu.stage2?.percent ?? null)}%.</p>
        <details><summary>Exact keyword lines and stage-1 settings</summary><pre style={{ whiteSpace: "pre-wrap" }}>{run.settings.keywordLines.join("\n")}</pre></details>
        <table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr><th style={cell}>Phrase</th><th style={cell}>Correct</th><th style={cell}>Misses: expected, heard → intent</th></tr></thead>
          <tbody>{run.scores.perPhrase.map(row => <tr key={row.phrase}><td style={cell}>{row.phrase}</td><td style={cell}>{row.correct}/{row.total}</td><td style={cell}>{row.misses.map(miss => <div key={miss.promptId}>{miss.expected}: {miss.heard.join(" | ") || "(no gated speech / no hit)"} → {miss.intents.join(" | ") || "none"}</div>)}</td></tr>)}</tbody>
        </table>
        <details><summary>All decisions with stage acceptance / rejection reasons</summary>{run.scores.items.map(item => <div key={item.promptId}><b>{item.phrase}</b>{item.observations.map((o, i) => <div key={i}>{o.heard || "(no hit)"} → {o.intent}: {o.note ?? "single stage"}</div>)}</div>)}</details>
        <h3>No-action items with activations</h3>
        {run.scores.items.filter(item => item.category !== "command" && item.actions > 0).map(item => <div key={item.promptId}><b>{item.phrase}</b>: {item.observations.filter(o => o.intent !== "none").map(o => `${o.heard || "(no hit)"} → ${o.intent}`).join(" | ")}</div>)}
      </details>)}
    </section>
  </main>;
}
