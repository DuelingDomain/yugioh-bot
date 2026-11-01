"use client";

import { useEffect, useRef, useState } from "react";
import { ygoModule, type RemoteActionProposal, type RemoteRoom } from "@yugidraft/shared/remote";
import { remoteButton, type RemoteDispatch } from "./remote-seat-panel";

type SpeechCapture = { start(): void; stop(): void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null };
export function proposalLabel(proposal: RemoteActionProposal) {
  switch (proposal.type) {
    case "lp.change": return `Seat ${proposal.seat + 1}: ${proposal.delta > 0 ? "+" : ""}${proposal.delta} LP`;
    case "attack.declare": return `Seat ${proposal.attackerSeat + 1}, ${proposal.attackerCardRef ?? "monster"} → seat ${proposal.targetSeat + 1}, ${proposal.direct ? "direct attack" : proposal.targetCardRef}`;
    case "twin.place": return `Place ${proposal.card.name ?? "card"} in ${proposal.zone}, seat ${proposal.seat + 1}`;
    case "phase.set": return `Phase: ${proposal.phase}`;
    case "log.note": return `Note: ${proposal.text}`;
    default: return proposal.type.replaceAll(".", " ");
  }
}

export function RemoteCommands({ room, actorSeat, busy, onAction }: { room: RemoteRoom; actorSeat: number; busy: boolean; onAction: RemoteDispatch }) {
  const [text, setText] = useState(""); const [message, setMessage] = useState(""); const [listening, setListening] = useState(false);
  const [preview, setPreview] = useState<{ seq: number; actorSeat: number; choices: { proposal: RemoteActionProposal; label: string }[] } | null>(null);
  const capture = useRef<SpeechCapture | null>(null);
  const [attacker, setAttacker] = useState(""); const [target, setTarget] = useState("");
  useEffect(() => () => { if (capture.current) { capture.current.onresult = null; capture.current.onerror = null; capture.current.onend = null; capture.current.stop(); } }, []);
  function propose() {
    setMessage(""); setPreview(null);
    const proposal = ygoModule.parseCommand({ text, actorSeat, state: room.state });
    if (proposal) setPreview({ seq: room.lastSeq, actorSeat, choices: [{ proposal, label: proposalLabel(proposal) }] });
    else showAttacks(ygoModule.resolveAttack(room.state, { text, players: room.seats }, actorSeat));
  }
  function showAttacks(result: ReturnType<typeof ygoModule.resolveAttack>) {
    setPreview(null);
    if (result.status === "none") { setMessage("No matching command or attack. Try an example below or select cards."); return; }
    setMessage(result.status === "ambiguous" ? "Choose the intended attack to confirm." : "Confirm the proposed attack.");
    setPreview({ seq: room.lastSeq, actorSeat, choices: result.candidates.map(c => ({ proposal: c.proposal,
      label: `${c.attacker.name ?? c.attacker.cardRef} → ${room.seats.find(s => s.seat === c.proposal.targetSeat)?.displayName}: ${c.target?.name ?? c.target?.cardRef ?? "direct attack"}` })) });
  }
  function listen() {
    const Constructor = (window as unknown as { SpeechRecognition?: new () => SpeechCapture; webkitSpeechRecognition?: new () => SpeechCapture });
    const Recognition = Constructor.SpeechRecognition ?? Constructor.webkitSpeechRecognition;
    if (!Recognition) { setMessage("Voice capture is unavailable in this browser. Type the same commands below."); return; }
    const recognition = new Recognition(); capture.current = recognition;
    recognition.onresult = event => { setText(event.results[0][0].transcript); setPreview(null); setMessage("Speech captured. Preview the command to continue."); };
    recognition.onerror = () => { setListening(false); setMessage("Microphone unavailable. Check permission or type the command."); };
    recognition.onend = () => setListening(false);
    try { recognition.start(); setListening(true); } catch { setMessage("Could not start voice capture."); }
  }
  const ownMonsters = room.state.seats.find(s => s.seat === actorSeat)?.twin.filter(c => c.zone === "monster" || c.zone === "extra-monster") ?? [];
  return <section className="space-y-3 border-t border-current/20 pt-4" aria-label="Voice and attack assistant">
    <h2 className="text-lg font-semibold">Voice & attack assistant</h2>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); propose(); }}>
      <label className="grid min-w-48 flex-1 gap-1 text-sm">Command<input className={remoteButton} maxLength={500} value={text} onChange={e => { setText(e.target.value); setPreview(null); }} placeholder="my dragon attacks Test Bot 1’s magician" /></label>
      <button className={remoteButton} disabled={busy || !text.trim()}>Preview command</button>
      <button type="button" className={remoteButton} disabled={busy} onClick={() => { if (listening) capture.current?.stop(); else listen(); }}>{listening ? "Stop listening" : "Use microphone"}</button>
    </form>
    <p className="text-xs opacity-70">Try “next phase”, “end turn”, “lose 500 LP”, “set LP to 8000”, “place Dark Magician in monster slot 3”, “flip Dark Magician face down”, “move slot 3 to graveyard”, “remove Dark Magician”, “undo”, or “note correction”. Commands act as the selected seat. Speech capture uses your browser’s speech service.</p>
    <form className="flex flex-wrap gap-2" onSubmit={e => {
      e.preventDefault(); const chosen = JSON.parse(target) as { seat: number; cardRef?: string; direct?: boolean };
      showAttacks(ygoModule.resolveAttack(room.state, { attacker: { cardRef: attacker }, targetSeat: chosen.seat, ...(chosen.direct ? { direct: true } : { target: { cardRef: chosen.cardRef } }) }, actorSeat));
    }}>
      <label className="grid gap-1 text-xs">Attacker<select className={remoteButton} value={attacker} onChange={e => setAttacker(e.target.value)}><option value="">Choose monster</option>{ownMonsters.map(c => <option key={c.ref} value={c.ref}>{c.faceUp ? c.name ?? c.ref : "Face-down monster"} ({c.ref})</option>)}</select></label>
      <label className="grid gap-1 text-xs">Target<select className={remoteButton} value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose target</option>{room.state.seats.filter(s => s.seat !== actorSeat && !s.eliminated).map(s => <optgroup key={s.seat} label={room.seats.find(p => p.seat === s.seat)?.displayName}>
        <option value={JSON.stringify({ seat: s.seat, direct: true })}>Seat {s.seat + 1} · direct attack</option>{s.twin.filter(c => c.zone === "monster" || c.zone === "extra-monster").map(c => <option key={c.ref} value={JSON.stringify({ seat: s.seat, cardRef: c.ref })}>Seat {s.seat + 1} · {c.faceUp ? c.name ?? c.ref : "Face-down monster"} ({c.ref})</option>)}
      </optgroup>)}</select></label>
      <button className={`${remoteButton} self-end`} disabled={busy || !attacker || !target}>Preview attack</button>
    </form>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {preview ? <div className="space-y-2 border-l-2 border-current pl-3">
      {preview.seq !== room.lastSeq || preview.actorSeat !== actorSeat ? <p role="alert">Table or selected seat changed. Preview the command again.</p> : null}
      {preview.choices.map((choice, i) => <div key={i} className="flex flex-wrap items-center gap-3 text-sm"><span>{choice.label}</span>
        <button className={remoteButton} disabled={busy || preview.seq !== room.lastSeq || preview.actorSeat !== actorSeat} onClick={() => { onAction(choice.proposal); setPreview(null); }}>Confirm{preview.choices.length > 1 ? ` attack ${i + 1}` : ""}</button>
      </div>)}
    </div> : null}
  </section>;
}
