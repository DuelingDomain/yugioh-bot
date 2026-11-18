"use client";
import { useState } from "react";
import { voiceCommands, voiceMethods, voiceMethodLabels, type VoiceMethod, type VoiceMark, type VoiceRecord } from "@/lib/remote/voice-diagnostics";
import { ThemedSelect } from "@/components/ui/themed-select";
import s from "./remote-ui.module.css";

const methodChoices = voiceMethods.map(m => ({ value: m, label: voiceMethodLabels[m] }));
const intendedChoices: { value: string; label: string }[] = [
  ...voiceCommands.map(command => ({ value: command, label: command })),
  { value: "nothing", label: "nothing (I did not say a command)" }, { value: "free-text", label: "Other words…" },
];

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
    <ThemedSelect variant="menu" wide label="Voice method" prefix="Voice ·" value={method} testId="voice-method" choices={methodChoices}
      onChange={found => { setLabel(null); onMethod(found); }} />
    {logging ? <>
      <span className={s.voiceLogBadge} role="status">VOICE LOG · text only</span>
      <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} disabled={!last} onClick={() => begin("wrong")}>Wrong</button>
      <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => begin("missed")}>It missed me</button>
      {label ? <form aria-label="Label voice result" onSubmit={event => { event.preventDefault(); onMark({ label, intended, note: intended === "free-text" ? note : "", utteranceId: target.utteranceId, method: target.method, contextIds: target.contextIds }); setLabel(null); }}>
        <span>{label === "wrong" ? `Wrong: “${target.text}”` : "What did you say?"}</span>
        <ThemedSelect variant="menu" wide label="Intended command" value={intended} testId="voice-intended" choices={intendedChoices}
          onChange={value => { const command = voiceCommands.find(c => c === value); if (command) setIntended(command); else if (value === "nothing" || value === "free-text") setIntended(value); }} />
        {intended === "free-text" ? <input aria-label="Intended words" maxLength={500} required value={note} onChange={event => setNote(event.target.value)} /> : null}
        <button type="submit" className={`${s.btn} ${s.sm}`}>Save label</button>
        <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => setLabel(null)}>Cancel</button>
      </form> : null}
    </> : null}
  </div>;
}
