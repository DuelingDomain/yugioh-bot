"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { DUEL_LIST_KEY, listDuelPresets, startDuelPreset } from "@/components/duel/api";
import { SheetButton, sheetRoot } from "@/components/duel/sheet-ui";
import { submitReport } from "@/components/duel/report-button";
import { addChecklistResult } from "@/components/duel/report-buffers";
import styles from "./dev-presets.module.css";

// TODO(host): `list-presets` does not return the core tag and sha or the known issues, and the web route
// /api/duels/preset only forwards `presets`. When the host adds `core: { tag, sha }` and `issues: string[]` per preset
// (from .status/issues/*.json) and the route forwards them, this page shows them. Until then: "unknown".
type CoreInfo = { tag?: unknown; sha?: unknown };
type PresetExtra = { issues?: unknown };

const lastSlugKey = (presetId: string) => `duel-preset-last:${presetId}`;
export function readLastSlug(presetId: string): string | null {
  try { return window.localStorage.getItem(lastSlugKey(presetId)); } catch { return null; }
}
function text(v: unknown): string { return typeof v === "string" && v ? v : "unknown"; }

const PRESETS_KEY = `${DUEL_LIST_KEY}/preset`;

export function DevPresets() {
  const router = useRouter();
  const { data, error, isLoading } = useSWR(PRESETS_KEY, listDuelPresets, { revalidateOnFocus: false });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, "pass" | "fail" | "saved" | "error">>({});

  async function mark(presetId: string, index: number, item: string, result: "pass" | "fail") {
    const key = `${presetId}:${index}`;
    addChecklistResult(presetId, item, result);
    setResults((r) => ({ ...r, [key]: result }));
    const slug = readLastSlug(presetId);
    if (!slug) return;
    try {
      await submitReport(slug, { category: "checklist", checklistItem: item, actual: result === "pass" ? "PASS" : "FAIL" }, { presetId, result });
      setResults((r) => ({ ...r, [key]: result }));
    } catch {
      setResults((r) => ({ ...r, [key]: "error" }));
    }
  }

  async function start(id: string) {
    setBusyId(id);
    setStartError(null);
    try {
      const { slug } = await startDuelPreset(id);
      try { window.localStorage.setItem(lastSlugKey(id), slug); } catch { /* storage may be blocked */ }
      router.push(`/duels/${encodeURIComponent(slug)}`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Could not start the preset");
      setBusyId(null);
    }
  }

  return (
    <div className={`${sheetRoot} ${styles.wrap}`}>
      <header className={styles.head}>
        <h1 className={styles.title}>Scenario presets</h1>
        <p className={styles.note}>Dev only. Each preset sets up a table with fixed cards and opens the room.</p>
      </header>
      {(() => {
        const core = (data as { core?: CoreInfo } | undefined)?.core;
        const tag = text((data as { coreTag?: unknown } | undefined)?.coreTag ?? core?.tag);
        const sha = text((data as { coreSha?: unknown } | undefined)?.coreSha ?? core?.sha);
        return <p className={styles.note} data-testid="core-info">Core tag: <code>{tag}</code> · sha: <code>{sha}</code></p>;
      })()}
      {startError ? <p role="alert" className={styles.error}>{startError}</p> : null}
      {error ? <p role="alert" className={styles.error}>{error instanceof Error ? error.message : "Could not load presets"}</p> : null}
      {isLoading ? <p className={styles.note}>Loading presets…</p> : null}
      {data && data.presets.length === 0 ? <p className={styles.empty}>The engine has no presets.</p> : null}
      <ul className={styles.list}>
        {data?.presets.map((preset) => (
          <li key={preset.id} className={styles.card}>
            <div className={styles.top}>
              <div className={styles.main}>
                <h2 className={styles.name}>{preset.title}</h2>
                <p className={styles.meta}>
                  <code>{preset.id}</code>
                  <span>{preset.format}</span>
                  {preset.needsMultiCore ? <span className={styles.flag}>Needs multi-seat core</span> : null}
                </p>
              </div>
              <SheetButton type="button" kind="primary" size="sm" loading={busyId === preset.id}
                disabled={busyId !== null} onClick={() => void start(preset.id)}>Start</SheetButton>
            </div>
            {(() => {
              const issues = (preset as PresetExtra).issues;
              const list = Array.isArray(issues) ? issues.filter((x): x is string => typeof x === "string") : [];
              return list.length > 0 ? (
                <div data-testid="known-issues">
                  <p className={styles.flag}>Known issues</p>
                  <ul className={styles.checklist}>{list.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              ) : <p className={styles.note} data-testid="known-issues">Known issues: unknown (the host does not list them yet).</p>;
            })()}
            {preset.checklist.length > 0 ? (
              <ol className={styles.checklist}>
                {preset.checklist.map((item, i) => {
                  const state = results[`${preset.id}:${i}`];
                  return (
                    <li key={i}>
                      {item}{" "}
                      <span className={styles.meta}>
                        <button type="button" aria-label={`Pass: ${item}`} aria-pressed={state === "pass"}
                          onClick={() => void mark(preset.id, i, item, "pass")}>Pass</button>
                        <button type="button" aria-label={`Fail: ${item}`} aria-pressed={state === "fail"}
                          onClick={() => void mark(preset.id, i, item, "fail")}>Fail</button>
                        {state === "error" ? <span role="alert" className={styles.flag}>Report not saved</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
