import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import type { DuelAnswer, DuelCard, DuelPrompt } from "@yugidraft/shared/duels";
import { DuelField } from "../src/components/duel/field";
import { DuelHistoryRail } from "../src/components/duel/history-rail";
import { MoveFx } from "../src/components/duel/move-fx";
import { PromptCenter } from "../src/components/duel/prompt-center";
import {
  activatePromptFromField, optionsForCard, promptLegalKeys, promptSelectedKeys, usePromptDraft,
} from "../src/components/duel/prompts";
import promptStyles from "../src/components/duel/prompt-center.module.css";
import type { ProofCase, ProofPageData } from "./bug-proof-types";

// Test-only page. The query chooses an untouched engine projection, not a mocked public identity.
const data: ProofPageData = JSON.parse(document.getElementById("engine-view")!.textContent!);
const scenario = data.cases.find((entry) => entry.id === new URLSearchParams(location.search).get("scenario"));
if (!scenario) throw new Error("Unknown proof scenario");
const noop = () => undefined;
const playerName = (seat: number) => `Player ${seat + 1}`;

function Proof({ scenario: s }: { scenario: ProofCase }) {
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<DuelPrompt | null>(null);
  const engine = s.materialViews?.[Math.min(step, s.materialViews.length - 1)] ?? s.engine;
  const prompt = preview ?? engine.prompt;
  const draft = usePromptDraft(prompt);

  function submit(answer: DuelAnswer) {
    if (prompt?.kind !== "toggle" || !answer.choice || step >= 2) return;
    const picked = prompt.options.find((option) => option.id === answer.choice && !option.selected);
    if (!picked || !s.materialCodes?.includes(picked.card?.code ?? -1)) return;
    if (s.materialViews?.[step + 1]) setStep(step + 1); // The real next core prompt after the first pick.
    else {
      // The core auto-completes after two. Show the second click pending submission on the last
      // real prompt; update ONLY selected flags, retaining its actual bounds/title/options.
      // completedView in snapshots.json proves this exact pair was accepted by the core.
      setPreview({ ...prompt, options: prompt.options.map((option) =>
        option.id === answer.choice ? { ...option, selected: true } : option) });
      setStep(2);
    }
  }
  function activate(keys: string[], card: DuelCard | null) {
    if (!prompt || s.bug !== 4) return;
    if (prompt.kind === "toggle") {
      const options = optionsForCard(prompt, card, keys);
      if (options.length === 1) submit({ choice: options[0].id });
    } else {
      activatePromptFromField(prompt, true, keys, card, draft);
    }
  }

  // Read actual rendered copy/art. Never echo expected strings into the page for assertions.
  window.readBugProof = () => {
    const history = document.querySelector<HTMLElement>('[aria-label="Duel history"]');
    const board = document.querySelector<HTMLElement>('[data-proof-board]')!;
    const promptRoot = board.querySelector<HTMLElement>(`.${promptStyles.layer}`)!;
    const loadedArt = (root: Element | null) => Array.from(root?.querySelectorAll<HTMLImageElement>(
      `img[src*="/cards/${s.targetCode}/image"]`) ?? []).some((img) =>
      img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0 &&
      getComputedStyle(img).visibility !== "hidden");
    const historyRows = Array.from(history?.querySelectorAll<HTMLElement>('li[data-icon]') ?? []).map((row) => ({
      text: row.querySelector<HTMLElement>(':scope > span[aria-hidden="true"][title]')?.innerText ?? "",
      icon: row.dataset.icon ?? null, showsTargetArt: loadedArt(row),
    }));
    const ghosts = Array.from(board.querySelectorAll<HTMLElement>('[data-testid="added-ghost"]'));
    const label = board.querySelector<HTMLElement>('[data-testid="added-label"]');
    const zone = s.setZone ? board.querySelector(`[data-zones~="${s.setZone}"]`) : null;
    const selectedCount = prompt?.kind === "toggle" ? prompt.options.filter((option) => option.selected).length : draft.selected.length;
    const counter = promptRoot.querySelector<HTMLElement>(`.${promptStyles.barCount}`);
    const confirm = Array.from(promptRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.innerText === "Confirm");
    const bar = promptRoot.querySelector<HTMLElement>("[data-ready]");
    return {
      historyRows,
      historyShowsTarget: historyRows.some((row) => row.text.includes(s.targetName) || row.showsTargetArt),
      revealShowsTarget: ghosts.some((ghost) => ghost.dataset.known === "true" && loadedArt(ghost)),
      revealText: label && Number(getComputedStyle(label).opacity) > 0 ? label.innerText : "",
      counterText: counter?.innerText ?? null,
      titleText: promptRoot.querySelector<HTMLElement>(`.${promptStyles.barText} > b`)?.innerText ?? null,
      detailText: promptRoot.querySelector<HTMLElement>(`.${promptStyles.barDetail}`)?.innerText ?? null,
      instructionText: promptRoot.querySelector<HTMLElement>(`.${promptStyles.barAsk}`)?.innerText ?? null,
      counterMet: counter ? counter.dataset.done === "true" : null,
      counterMarker: counter ? getComputedStyle(counter, "::before").content : null,
      confirmEnabled: confirm ? !confirm.disabled : null,
      promptReady: bar ? bar.dataset.ready === "true" : null,
      promptText: promptRoot.innerText,
      fieldCardBack: zone ? zone.querySelector('[data-card-art]') != null && zone.querySelector('img') == null : null,
      fieldCardPosition: s.setZone ? engine.seats[0].spells.find((card) => card &&
        `${card.controller}:${card.location}:${card.sequence}` === s.setZone)?.position ?? null : null,
      step: s.bug === 4 ? selectedCount : step,
      pendingAnswerPreview: preview != null,
    };
  };

  // Phones stack the board above the history, as the room does below 900px.
  const phone = window.innerWidth < 600;
  return <main data-proof-scenario={s.id} data-proof-step={step}>
    <h1>{s.title}</h1>
    <p>Real stock-core snapshot · {s.mySeat == null ? "spectator" : `seat ${s.mySeat}`} · turn {engine.turn}
      {preview ? " · second material click: pending-answer preview (core completes immediately)" : ""}</p>
    <div style={{ display: "grid", gridTemplateColumns: phone ? "minmax(0, 1fr)" : "350px minmax(0, 1fr)", gap: 20 }}>
      <aside style={{ display: "flex", height: phone ? 420 : 760, minHeight: 0, order: phone ? 1 : 0 }}>
        <DuelHistoryRail events={engine.events} engine={engine} mySeat={s.mySeat}
          playerName={playerName} onInspectCard={noop} reducedMotion />
      </aside>
      <div data-proof-board data-proof-prompt style={{ position: "relative", height: 760, minWidth: 0 }}>
        <DuelField engine={engine} mySeat={s.mySeat} masterRule={5} reducedMotion
          legalKeys={promptLegalKeys(prompt)} selectedKeys={promptSelectedKeys(prompt, draft.selected)}
          onActivate={activate} onInspect={noop}
          bottomName={playerName(s.mySeat ?? 0)} topName={playerName(s.mySeat === 1 ? 0 : 1)} />
        {s.bug !== 4 ? <MoveFx events={engine.events} duelKey={s.id} reducedMotion replayFrom={s.replayFrom} /> : null}
        <PromptCenter prompt={prompt} mySeat={s.mySeat} active slug={s.id} busy={preview != null}
          draft={draft} onSubmit={submit} menuOpen={false} chain={engine.chain} aimLocked={false}
          reducedMotion revision={engine.revision} />
      </div>
    </div>
    <p style={{ marginTop: 12 }}>Card images use labelled local SVG placeholders; events, prompts, history and field components are real.</p>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Proof scenario={scenario} />);
