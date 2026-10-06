"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { DuelFormat, DuelTableCapabilities } from "@yugidraft/shared/duels";
import { StatusLine, SvButton } from "@/components/sheet";
import { PageFrame } from "@/components/decks/page-frame";
import { SandboxBuilder } from "@/components/sandbox/builder";
import { createScenario, deleteScenario, updateScenario } from "@/components/sandbox/api";
import { createBuilderState, loadBuilderState, type SandboxBuilderState } from "@/components/sandbox/board-model";
import { copyName, shareUrl } from "../_lib/labels";
import type { ScenarioData } from "../_lib/load";
import styles from "./sandbox.module.css";

/** A board that is not saved yet, for example the one a running duel started from. Parsed in the browser. */
export interface EditorDraft {
  board: unknown;
  run?: unknown;
}

interface ScenarioEditorProps {
  /** A saved scenario. Without it the page is /sandbox/new. */
  scenario?: ScenarioData;
  draft?: EditorDraft;
  format?: DuelFormat;
  capabilities: DuelTableCapabilities;
}

type Notice = { kind: "ready" | "warn"; text: string; link?: string } | null;

function startState(props: ScenarioEditorProps): { state: SandboxBuilderState; problem: string | null } {
  const source = props.scenario ?? props.draft;
  if (source) {
    try {
      return { state: loadBuilderState(source.board, source.run), problem: null };
    } catch (error) {
      const why = error instanceof Error ? error.message : "The board is not valid.";
      return { state: createBuilderState(props.format), problem: `This board could not be loaded (${why}). Starting from an empty board.` };
    }
  }
  return { state: createBuilderState(props.format), problem: null };
}

export function ScenarioEditor(props: ScenarioEditorProps) {
  const { scenario, capabilities } = props;
  const router = useRouter();
  // The first board only: later edits live in the builder.
  const [start] = React.useState(() => startState(props));
  const [id, setId] = React.useState<number | undefined>(scenario?.id);
  const [mine, setMine] = React.useState(scenario ? scenario.mine : true);
  const [name, setName] = React.useState(scenario?.name ?? "");
  const [dirty, setDirty] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice>(start.problem ? { kind: "warn", text: start.problem } : null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const saved = id !== undefined;
  const copyMode = saved && !mine;

  /** Save or update. Returns the id of the saved scenario. A saved board changes the address without a reload. */
  async function persist(state: SandboxBuilderState): Promise<number> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name the board first.");
    if (saved && mine) {
      await updateScenario(id, { name: trimmed, board: state.board, run: state.run });
      setDirty(false);
      return id;
    }
    // New board, or another admin's board: both make a new scenario that you own.
    const created = await createScenario({
      name: copyMode && trimmed === scenario?.name ? copyName(trimmed) : trimmed,
      board: state.board,
      run: state.run,
    });
    setId(created.id);
    setMine(true);
    setName(created.name);
    setDirty(false);
    window.history.replaceState(null, "", `/sandbox/${created.id}`);
    return created.id;
  }

  async function onSave(state: SandboxBuilderState) {
    const wasCopy = copyMode;
    await persist(state);
    setNotice({ kind: "ready", text: wasCopy ? "Saved as your copy." : "Saved." });
  }

  async function onShare(state: SandboxBuilderState) {
    let target = id;
    let text = "Link copied. Any admin who opens it starts the duel at once.";
    if (target === undefined || (mine && dirty)) {
      target = await persist(state);
    } else if (dirty) {
      text = "Link copied. It starts the saved original, not your changes. Save as copy to share those.";
    }
    const url = shareUrl(window.location.origin, target);
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      copied = false;
    }
    setNotice(copied ? { kind: "ready", text } : { kind: "warn", text: "Could not copy. Copy the link below.", link: url });
  }

  async function remove() {
    if (id === undefined) return;
    setDeleting(true);
    try {
      await deleteScenario(id);
      router.push("/sandbox");
    } catch (error) {
      setNotice({ kind: "warn", text: error instanceof Error ? error.message : "Could not delete this scenario." });
      setConfirmDelete(false);
      setDeleting(false);
    }
  }

  const title = scenario || saved ? name.trim() || "Scenario" : "New scenario";
  const sub = copyMode ? `By ${scenario?.ownerName ?? "another admin"}. Play it, or save a copy to change it.` : saved ? "Your scenario" : undefined;

  return (
    <PageFrame
      title={title}
      sub={sub}
      back={{ href: "/sandbox", label: "Back to scenarios" }}
      actions={
        saved && mine ? (
          confirmDelete ? (
            <>
              <SvButton variant="danger" disabled={deleting} onClick={() => void remove()}>Delete</SvButton>
              <SvButton variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>Keep</SvButton>
            </>
          ) : (
            <button type="button" className={`${styles.iconBtn} ${styles.danger}`} aria-label="Delete scenario" title="Delete scenario" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={18} aria-hidden="true" />
            </button>
          )
        ) : undefined
      }
    >
      {notice ? (
        <div role={notice.kind === "warn" ? "alert" : "status"} className={styles.notice}>
          <StatusLine tone={notice.kind}>{notice.text}</StatusLine>
          {notice.link ? <span className={styles.noticeLink}>{notice.link}</span> : null}
        </div>
      ) : null}
      <SandboxBuilder
        initial={start.state}
        name={name}
        onNameChange={(value) => {
          setName(value);
          setDirty(true);
        }}
        capabilities={capabilities}
        scenarioId={saved && (mine || !dirty) ? id : undefined}
        onChange={() => {
          setDirty(true);
          setNotice(null);
        }}
        onStarted={(slug) => router.push(`/duels/${slug}`)}
        onSave={onSave}
        saveLabel={copyMode ? "Save as copy" : "Save"}
        onShare={onShare}
      />
    </PageFrame>
  );
}
