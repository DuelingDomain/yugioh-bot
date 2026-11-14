"use client";
import { useState } from "react";
import { voiceCommands, voiceMethods, voiceMethodLabels, type VoiceMethod, type VoiceMark, type VoiceRecord } from "@/lib/remote/voice-diagnostics";
import s from "./remote-ui.module.css";

export function VoiceControls({ method, onMethod, logging, last, recentIds, onMark }: {
  method: VoiceMethod; onMethod(method: VoiceMethod): void; logging: boolean; last: Extract<VoiceRecord, { kind: "utterance" }> | null; recentIds: string[];
  onMark(mark: Omit<VoiceMark, "kind" | "at">): void;
}) {
  const [label, setLabel] = useState<"wrong" | "missed" | null>(null);
  const [intended, setIntended] = useState<VoiceMark["intended"]>("nothing");
  const [note, setNote] = useState("");
  const [target, setTarget] = useState<{ utteranceId: string | null; method: VoiceMethod; text: string; contextIds: string[] }>({ utteranceId: null, method, text: "", contextIds: [] });
  const begin = (label: "wrong" | "missed") => {
    setLabel(label); setNote(""); setIntended(label === "wrong" ? "nothing" : "end turn");
    setTarget({ utteranceId: label === "wrong" ? last?.utteranceId ?? null : null, method: label === "wrong" && last ? last.method : method, text: last?.text ?? "", contextIds: [...recentIds] });
  };
  return <div className={s.voiceTools}>
    <label>Voice method <select aria-label="Voice method" value={method} onChange={event => { const found = voiceMethods.find(m => m === event.target.value); if (found) { setLabel(null); onMethod(found); } }}>
      {voiceMethods.map(m => <option key={m} value={m}>{voiceMethodLabels[m]}</option>)}
    </select></label>
    {logging ? <>
      <span className={s.voiceLogBadge} role="status">VOICE LOG · text only</span>
      <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} disabled={!last} onClick={() => begin("wrong")}>Wrong</button>
      <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => begin("missed")}>It missed me</button>
      {label ? <form aria-label="Label voice result" onSubmit={event => { event.preventDefault(); onMark({ label, intended, note: intended === "free-text" ? note : "", utteranceId: target.utteranceId, method: target.method, contextIds: target.contextIds }); setLabel(null); }}>
        <span>{label === "wrong" ? `Wrong: “${target.text}”` : "What did you say?"}</span>
        <select aria-label="Intended command" value={intended} onChange={event => { const value = event.target.value; const command = voiceCommands.find(c => c === value); if (command) setIntended(command); else if (value === "nothing" || value === "free-text") setIntended(value); }}>
          {voiceCommands.map(command => <option key={command} value={command}>{command}</option>)}
          <option value="nothing">nothing (I did not say a command)</option><option value="free-text">Other words…</option>
        </select>
        {intended === "free-text" ? <input aria-label="Intended words" maxLength={500} required value={note} onChange={event => setNote(event.target.value)} /> : null}
        <button type="submit" className={`${s.btn} ${s.sm}`}>Save label</button>
        <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => setLabel(null)}>Cancel</button>
      </form> : null}
    </> : null}
  </div>;
}
