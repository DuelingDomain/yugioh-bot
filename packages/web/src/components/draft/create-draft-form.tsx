"use client";

/**
 * Normal draft creation, as the Workbench: sources and the card preview on the left, the pool you edit in the middle,
 * the rules and Create on the right. One pool editor feeds all three. The request is the real config: target seats,
 * explicit rounds, the custom Main and Extra pools and the Extra Deck round.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { HideImportEntriesContext, ImportEntries, type ImportEntryView } from "@/components/card-list-import/auto-import-box";
import { configFromFields, type DraftConfigFieldsValue } from "./draft-config-fields";
import { importLine, reportOf } from "./pool/pool-model";
import { usePoolEditor } from "./pool/use-pool-editor";
import { PoolBrowser, type PoolBrowserHandle } from "./setup/pool-browser";
import { RulesMetaFields, RulesPanel, useRulesAnalysis } from "./setup/rules-panel";
import { applyPreset, readinessText } from "./setup/rules-model";
import { SourceRail, type SourceTab } from "./setup/source-rail";
import { useCardInspector } from "./setup/use-card-inspector";
import type { PoolEditActions, PoolLane } from "./setup/pool-browser-model";
import {
  DRAWER_SHUT_CLASS,
  Workbench,
  WorkbenchCreate,
  WorkbenchDock,
  WorkbenchEmpty,
  WorkbenchError,
  useWorkbenchLayout,
  useWorkbenchMode,
} from "./setup/workbench";

type Channel = { id: string; name: string };

/** The server posts to its own channel when none is chosen. */
const DEFAULT_CHANNEL: Channel = { id: "", name: "default" };

const BASE_FIELDS: DraftConfigFieldsValue = {
  cardsPerPlayerText: "",
  packSizeText: "",
  pickSecondsText: "",
  picksPerStep: 1,
  extraDeckEnabled: false,
  extraDeckSizeText: "15",
};

const COPY_LIMIT = 3;
const fmt = (n: number) => n.toLocaleString("en-US");

export function CreateDraftForm() {
  const router = useRouter();
  const pool = usePoolEditor({ variant: "create" });
  const mode = useWorkbenchMode();
  const layout = useWorkbenchLayout(mode);

  const [name, setName] = React.useState("");
  // Set after mount so the server and the first client render agree.
  const [autoName, setAutoName] = React.useState("");
  const [channelId, setChannelId] = React.useState("");
  const [channels, setChannels] = React.useState<Channel[]>([DEFAULT_CHANNEL]);
  const [fields, setFields] = React.useState<DraftConfigFieldsValue>(() => applyPreset(BASE_FIELDS, "community"));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<SourceTab>("cards");

  const browser = React.useRef<PoolBrowserHandle>(null);
  // A request to put the cursor somewhere that is not on screen yet. It runs after the next commit.
  const [focusRequest, setFocusRequest] = React.useState<{ n: number; target: "cards" | "filter" } | null>(null);

  React.useEffect(() => {
    setAutoName(`Cube draft · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/discord/channels")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setChannels([DEFAULT_CHANNEL, ...((data.channels ?? []) as Channel[])]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = React.useMemo(() => {
    let reachable = 0;
    for (const copies of pool.pool.values()) reachable += Math.min(copies, COPY_LIMIT);
    return { main: pool.total, extra: pool.extraTotal, mainReachable: reachable };
  }, [pool.pool, pool.total, pool.extraTotal]);
  const analysis = useRulesAnalysis(fields, counts);
  const createDisabled = !analysis.ok || submitting || pool.loading;

  const { step } = pool;
  const actions = React.useMemo<PoolEditActions>(
    () => ({
      onStep: (id, delta, lane) => step(id, delta, lane),
      onSetCopies: (id, copies, lane: PoolLane) => {
        const have = (lane === "extra" ? pool.extra : pool.pool).get(id) ?? 0;
        step(id, copies - have, lane);
      },
      onRemove: (id, lane: PoolLane) => {
        const have = (lane === "extra" ? pool.extra : pool.pool).get(id) ?? 0;
        step(id, -have, lane);
      },
    }),
    [step, pool.pool, pool.extra],
  );

  // The inspector sits in the left column when it is wide and open. Anywhere else it is the card sheet.
  const inspector = useCardInspector({
    main: pool.pool,
    extra: pool.extra,
    getCard: pool.info,
    actions,
    mode: mode === "wide" && !layout.sourcesCollapsed ? "pane" : "sheet",
  });

  const entries = React.useMemo<ImportEntryView[]>(
    () => pool.imports.map((record) => ({ key: record.key, label: record.label, line: importLine(record), report: reportOf(record) })),
    [pool.imports],
  );

  const submit = async () => {
    if (createDisabled) return;
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        name: name.trim() || autoName || "Cube draft",
        channelId: channelId || undefined,
        config: { ...configFromFields(fields), ...pool.config(), includeNames: [], excludeNames: [] },
      };
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create draft");
      }
      const draft = await res.json();
      router.push(draft.webSlug ? `/draft/${draft.webSlug}` : "/drafts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      // The error shows next to the Create button: bring that column back if it was collapsed.
      layout.expandRules();
      if (mode === "phone") layout.setPhoneTab("rules");
    } finally {
      setSubmitting(false);
    }
  };
  const submitRef = React.useRef(submit);
  submitRef.current = submit;

  const showSource = (next: SourceTab) => {
    setTab(next);
    layout.openSources();
  };
  const searchCards = () => {
    showSource("cards");
    setFocusRequest((r) => ({ n: (r?.n ?? 0) + 1, target: "cards" }));
  };
  const focusFilter = () => {
    if (mode === "phone") layout.setPhoneTab("pool");
    setFocusRequest((r) => ({ n: (r?.n ?? 0) + 1, target: "filter" }));
  };
  // Runs after the children's effects (the drawer moves focus to its first tab), so the cursor lands where it was asked.
  React.useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.target === "filter") browser.current?.focusSearch();
    else document.querySelector<HTMLInputElement>('input[aria-label="Search cards by name"]')?.focus();
  }, [focusRequest]);

  const drawer = mode === "mid" ? { open: layout.drawerOpen, onClose: layout.closeSources } : undefined;
  const sources = (
    <HideImportEntriesContext.Provider value={true}>
      <SourceRail
        ctl={pool}
        inspector={inspector}
        tab={tab}
        onTabChange={setTab}
        drawer={drawer}
        onCollapse={mode === "wide" ? layout.collapseSources : undefined}
        className={drawer && !drawer.open ? DRAWER_SHUT_CLASS : undefined}
      />
    </HideImportEntriesContext.Provider>
  );

  const createError = error ? <WorkbenchError>{error}</WorkbenchError> : null;
  const phone = mode === "phone";
  const stripCreate = <WorkbenchCreate kind="icon" disabled={createDisabled} busy={submitting} onClick={submit} />;

  const rules = (
    <RulesPanel
      value={fields}
      onChange={setFields}
      pool={counts}
      metaSlot={
        <RulesMetaFields
          name={name}
          onNameChange={setName}
          namePlaceholder={autoName || "Cube draft"}
          channelId={channelId}
          onChannelChange={setChannelId}
          channels={channels}
          channelHint="The bot posts the lobby here. Players join from Discord. Default uses the server's channel."
        />
      }
      actionSlot={
        phone ? undefined : (
          <>
            {createError}
            <WorkbenchCreate disabled={createDisabled} busy={submitting} onClick={submit} />
          </>
        )
      }
    />
  );

  const dock = (
    <WorkbenchDock
      total={`${fmt(counts.main)} Main${counts.extra > 0 ? ` · ${fmt(counts.extra)} Extra` : ""}`}
      detail={readinessText(analysis)}
      tone={analysis.ok ? "ok" : "bad"}
      error={error}
    >
      <WorkbenchCreate kind="dock" disabled={createDisabled} busy={submitting} onClick={submit} />
    </WorkbenchDock>
  );

  return (
    <Workbench
      layout={layout}
      sources={sources}
      banner={entries.length > 0 ? <ImportEntries entries={entries} onRemove={(key) => pool.removeImport(Number(key))} /> : null}
      pool={
        <PoolBrowser
          ref={browser}
          title="Draft pool"
          main={pool.pool}
          extra={pool.extra}
          getCard={pool.info}
          actions={actions}
          inspector={inspector}
          emptyState={<WorkbenchEmpty onList={() => showSource("list")} onCubes={() => showSource("cubes")} onSearch={searchCards} />}
        />
      }
      rules={rules}
      poolCount={counts.main + counts.extra}
      tone={analysis.ok ? "ok" : "bad"}
      stripAction={stripCreate}
      dock={dock}
      onCreate={() => void submitRef.current()}
      onSearchCards={searchCards}
      onFocusFilter={focusFilter}
    />
  );
}
