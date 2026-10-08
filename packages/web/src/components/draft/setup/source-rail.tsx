"use client";

/**
 * The Workbench's left column: where cards come from, and the card inspector.
 *
 * Two views share the column, and a switch at the top (Sources / Card) moves between them:
 *   - Sources: Cards, Archetype, Set, List and Cubes. Every add goes through the pool editor you pass in (`ctl`), so the
 *     rules of the old form are unchanged: a paste, a dropped file or a loaded file is added at once and only once, typed
 *     text waits for Enter or Add, Remove takes out only what that list still adds, and an answer that arrives after the
 *     cube or the pool changed is dropped.
 *   - Card: the inspector (big art, full text, copies stepper, Remove card) for the card you preview or pin in the pool.
 *
 * The view follows the pool: hovering or focusing a card shows it at once, a pin keeps it, Unpin goes back to Sources. The
 * Sources / Card switch always works by hand. A dot on "Card" says a card is still pinned while you look at Sources.
 * Nothing in here is reset when you move between tabs or views: a tab that was opened once stays mounted (hidden), so the
 * typed text, the waiting lists and the import rows of the List tab stay as they are.
 * On a phone (`inspector.sheet`) there is no switch: the column shows Sources and the inspector is the bottom sheet.
 *
 * Usage:
 *   const ctl = usePoolEditor({ variant: "create" });
 *   const inspector = useCardInspector({ main: ctl.pool, extra: ctl.extra, getCard: ctl.info, actions });
 *   <SourceRail ctl={ctl} inspector={inspector} />
 *
 * Props:
 *   ctl           the pool editor (`usePoolEditor`).
 *   inspector     the controller from `useCardInspector`; the rail renders `CardInspector` for it.
 *   tab, defaultTab, onTabChange   the selected source. Pass `tab` to control it (for "Add cards" buttons elsewhere).
 *   drawer        `{ open, onClose }` turns the column into a left drawer with a scrim (mid-width screens). While it is
 *                 closed it is inert and out of the Tab order. Open, it is a modal dialog named "Add cards": Tab stays inside and
 *                 Esc closes it, unless the inspector used that Esc to unpin.
 *   inspect       false when the card preview is shown elsewhere (a docked left column): the rail then holds only the sources,
 *                 with no Sources / Card switch. Default true.
 *   onCollapse    shows a collapse button in the header (desktop). Ignored when `drawer` is set (it gets a Close button).
 *   cubeActions   Save as new cube / Save changes / Reset under the Cubes tab (default true).
 *   className     for the column.
 */

import * as React from "react";
import { ChevronLeft, ExternalLink, X } from "lucide-react";
import { CardInspector } from "./card-inspector";
import type { CardInspectorController } from "./use-card-inspector";
import { ArchetypeTab, CardTab, Hint, ListTab, NoteLine, SetTab, type Note } from "../pool/add-cards";
import { CubePicker } from "../pool/cube-picker";
import { StatusBar } from "../pool/status-bar";
import type { PoolEditor } from "../pool/use-pool-editor";
import { cardsText } from "../pool/pool-model";
import { segmentSlide, svButtonClass } from "@/components/sheet";
import { useTabDirection, type PaneDirection } from "@/lib/tab-motion";
import poolStyles from "../pool/pool.module.css";
import styles from "./source-rail.module.css";

export type SourceTab = "cards" | "archetype" | "set" | "list" | "cubes";
export type RailView = "sources" | "card";
const RAIL_VIEWS: readonly RailView[] = ["sources", "card"];

export const SOURCE_TABS: ReadonlyArray<{ value: SourceTab; label: string }> = [
  { value: "cards", label: "Cards" },
  { value: "archetype", label: "Archetype" },
  { value: "set", label: "Set" },
  { value: "list", label: "List" },
  { value: "cubes", label: "Cubes" },
];
const SOURCE_TAB_ORDER: readonly SourceTab[] = SOURCE_TABS.map((t) => t.value);

export interface SourceRailProps {
  ctl: PoolEditor;
  inspector: CardInspectorController;
  tab?: SourceTab;
  defaultTab?: SourceTab;
  onTabChange?: (tab: SourceTab) => void;
  drawer?: { open: boolean; onClose: () => void };
  inspect?: boolean;
  onCollapse?: () => void;
  cubeActions?: boolean;
  className?: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && typeof el.matches === "function" && el.matches("input, textarea, select, [contenteditable='true'], [contenteditable='']");
}

/** The view of the column: Sources or Card. It follows the pin and the preview, and the switch overrides it by hand. */
function useRailView(inspector: CardInspectorController): { view: RailView; choose: (view: RailView) => void } {
  const { pinnedId, previewId, sheet } = inspector;
  // `held` is a Card view opened by hand: it stays when the pin goes away.
  const [state, setState] = React.useState<{ view: RailView; held: boolean; pin: number | null }>({ view: "sources", held: false, pin: pinnedId });
  if (state.pin !== pinnedId) {
    // A new pin shows the card. When the pin goes, the column goes back to Sources unless the user chose Card by hand.
    setState(
      pinnedId !== null
        ? { view: "card", held: state.held, pin: pinnedId }
        : { view: state.held ? state.view : "sources", held: state.held, pin: pinnedId },
    );
  }
  const choose = React.useCallback((view: RailView) => setState((s) => ({ view, held: view === "card", pin: s.pin })), []);
  const view: RailView = sheet ? "sources" : previewId !== null ? "card" : state.view;
  return { view, choose };
}

export function SourceRail({ ctl, inspector, tab: tabProp, defaultTab = "cards", onTabChange, drawer, inspect = true, onCollapse, cubeActions = true, className }: SourceRailProps) {
  const ids = React.useId();
  const [tabState, setTabState] = React.useState<SourceTab>(defaultTab);
  const tab = tabProp ?? tabState;
  const [note, setNote] = React.useState<Note | null>(null);
  // A tab that was shown once stays mounted, so what is typed, loading or waiting in it is not lost.
  const [visited, setVisited] = React.useState<ReadonlySet<SourceTab>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set(visited).add(tab));

  const { view: railView, choose } = useRailView(inspector);
  const sheet = inspector.sheet;
  // The Sources / Card switch exists only when the inspector lives in this column.
  const split = inspect && !sheet;
  const view: RailView = split ? railView : "sources";
  const closed = drawer ? !drawer.open : false;

  const selectTab = (next: SourceTab) => {
    setTabState(next);
    setNote(null);
    onTabChange?.(next);
  };

  const railRef = React.useRef<HTMLElement>(null);
  const tabKeys = (event: React.KeyboardEvent) => {
    const at = SOURCE_TABS.findIndex((t) => t.value === tab);
    let to = -1;
    if (event.key === "ArrowRight") to = (at + 1) % SOURCE_TABS.length;
    else if (event.key === "ArrowLeft") to = (at - 1 + SOURCE_TABS.length) % SOURCE_TABS.length;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = SOURCE_TABS.length - 1;
    if (to < 0) return;
    event.preventDefault();
    selectTab(SOURCE_TABS[to]!.value);
    railRef.current?.querySelector<HTMLElement>(`[data-source-tab="${SOURCE_TABS[to]!.value}"]`)?.focus();
  };

  // Drawer: focus goes in when it opens and back to what opened it when it closes; Esc closes it.
  const opener = React.useRef<HTMLElement | null>(null);
  const open = drawer?.open ?? false;
  const onClose = drawer?.onClose;
  React.useEffect(() => {
    if (!open) return;
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) opener.current = document.activeElement;
    railRef.current?.querySelector<HTMLElement>("[data-source-tab][tabindex='0']")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      e.preventDefault();
      onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const back = opener.current;
      opener.current = null;
      if (back && back.isConnected) back.focus();
    };
  }, [open, onClose]);

  // A modal drawer keeps Tab inside it.
  const trapTab = (e: React.KeyboardEvent) => {
    if (!open || e.key !== "Tab") return;
    const items = Array.from(railRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]") ?? []).filter(
      (el) => el.tabIndex >= 0 && !el.closest("[hidden]"),
    );
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Which way each switch travelled, for the panels' arrival (globals.css, data-pane).
  // The view also flips by itself (a hovered or pinned card shows at once), and that stays instant: only the switch
  // buttons set `byHand`, for the render their click causes.
  const byHand = React.useRef(false);
  const viewDir = useTabDirection(view, RAIL_VIEWS, byHand.current);
  const tabDir = useTabDirection(tab, SOURCE_TAB_ORDER);

  const pick = (next: RailView) => {
    byHand.current = true;
    setTimeout(() => {
      byHand.current = false;
    }, 50);
    choose(next);
  };

  const sourcesId = `${ids}-sources`;
  const cardId = `${ids}-card`;
  const pinnedAway = inspector.pinnedId !== null && view !== "card";
  const dotId = `${ids}-dot`;

  const rail = (
    <aside
      ref={railRef}
      className={`${styles.rail}${drawer ? ` ${styles.drawer}` : ""}${className ? ` ${className}` : ""}`}
      role={drawer && open ? "dialog" : undefined}
      aria-modal={drawer && open ? true : undefined}
      aria-label={drawer ? "Add cards" : "Sources and card preview"}
      onKeyDown={drawer ? trapTab : undefined}
      data-view={view}
      data-open={drawer ? (drawer.open ? "" : undefined) : undefined}
      inert={closed || undefined}
      aria-hidden={closed || undefined}
    >
      <div className={styles.head}>
        {!split ? (
          <h2 className={styles.title}>Sources</h2>
        ) : (
          <div className={styles.switch} role="tablist" aria-label="Left panel" data-hand={viewDir ? "" : undefined} {...segmentSlide(RAIL_VIEWS.length, RAIL_VIEWS.indexOf(view))}>
            <button type="button" role="tab" id={`${ids}-t-sources`} aria-selected={view === "sources"} aria-controls={sourcesId} onClick={() => pick("sources")}>
              Sources
            </button>
            <button
              type="button"
              role="tab"
              id={`${ids}-t-card`}
              aria-selected={view === "card"}
              aria-controls={cardId}
              aria-describedby={pinnedAway ? dotId : undefined}
              onClick={() => pick("card")}
            >
              Card
              {pinnedAway && <i className={styles.pdot} aria-hidden="true" data-testid="pinned-dot" />}
            </button>
            {pinnedAway && (
              <span id={dotId} className={styles.sr}>
                A card is pinned.
              </span>
            )}
          </div>
        )}
        {drawer ? (
          <button type="button" className={styles.iconBtn} aria-label="Close sources" onClick={drawer.onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        ) : onCollapse ? (
          <button type="button" className={styles.iconBtn} aria-label="Collapse sources" title="Collapse ([)" onClick={onCollapse}>
            <ChevronLeft size={17} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className={styles.sources} id={sourcesId} data-pane="self" data-pane-dir={viewDir} role={split ? "tabpanel" : undefined} aria-labelledby={split ? `${ids}-t-sources` : undefined} hidden={view === "card"}>
        <div className={styles.tabs} role="tablist" aria-label="Where cards come from" onKeyDown={tabKeys} {...segmentSlide(SOURCE_TABS.length, SOURCE_TAB_ORDER.indexOf(tab))}>
          {SOURCE_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              data-source-tab={t.value}
              id={`${ids}-s-${t.value}`}
              aria-selected={tab === t.value}
              aria-controls={`${ids}-p-${t.value}`}
              tabIndex={tab === t.value ? 0 : -1}
              onClick={() => selectTab(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className={styles.body}>
          {visited.has("cards") && (
            <Pane dir={tabDir} ids={ids} value="cards" tab={tab}>
              <CardTab ctl={ctl} setNote={setNote} />
              {tab === "cards" && <NoteLine note={note} />}
            </Pane>
          )}
          {visited.has("archetype") && (
            <Pane dir={tabDir} ids={ids} value="archetype" tab={tab}>
              <ArchetypeTab ctl={ctl} setNote={setNote} />
              {tab === "archetype" && <NoteLine note={note} />}
            </Pane>
          )}
          {visited.has("set") && (
            <Pane dir={tabDir} ids={ids} value="set" tab={tab}>
              <SetTab ctl={ctl} setNote={setNote} />
              {tab === "set" && <NoteLine note={note} />}
            </Pane>
          )}
          {visited.has("list") && (
            <Pane dir={tabDir} ids={ids} value="list" tab={tab}>
              <ListTab ctl={ctl} />
            </Pane>
          )}
          {visited.has("cubes") && (
            <Pane dir={tabDir} ids={ids} value="cubes" tab={tab}>
              <CubesSource ctl={ctl} cubeActions={cubeActions} />
            </Pane>
          )}
        </div>
      </div>

      {sheet ? (
        <CardInspector controller={inspector} />
      ) : (
        split &&
        view === "card" && (
          <div className={styles.cardPane} id={cardId} data-pane="self" data-pane-dir={viewDir} role="tabpanel" aria-labelledby={`${ids}-t-card`}>
            <CardInspector controller={inspector} className={styles.insp} />
          </div>
        )
      )}
    </aside>
  );

  if (!drawer) return rail;
  return (
    <>
      {drawer.open && <button type="button" className={styles.scrim} tabIndex={-1} aria-label="Close sources" onClick={drawer.onClose} />}
      {rail}
    </>
  );
}

function Pane({ ids, value, tab, dir, children }: { ids: string; value: SourceTab; tab: SourceTab; dir: PaneDirection | undefined; children: React.ReactNode }) {
  return (
    <div className={styles.pane} data-pane="self" data-pane-dir={dir} id={`${ids}-p-${value}`} role="tabpanel" aria-labelledby={`${ids}-s-${value}`} hidden={tab !== value}>
      {children}
    </div>
  );
}

/**
 * Cubes: the cube the pool started from (with its link and a way back to a blank pool), the list of saved cubes, and the
 * save actions. Picking a cube loads it at once; the editor drops an answer that arrives after another pick.
 */
export function CubesSource({ ctl, cubeActions = true }: { ctl: PoolEditor; cubeActions?: boolean }) {
  const meta = ctl.meta;
  const mine = meta !== null && ctl.userId !== null && meta.creatorId === ctl.userId;
  const by = mine ? "you" : meta?.creatorName ?? null;
  if (!ctl.ready) return <p className={poolStyles.loading}>Loading cubes.</p>;
  return (
    <>
      <Hint>Start from a saved cube. The pool loads into this draft. Your cube stays unchanged.</Hint>
      {meta && (
        <section className={styles.active} aria-label="Chosen cube">
          <div className={styles.activeTop}>
            <b className={styles.activeName}>
              {meta.name}
              {ctl.edited ? ", edited" : ""}
            </b>
            <a className={poolStyles.lnk} href={`/cubes/${meta.cubeId}`} target="_blank" rel="noopener noreferrer">
              Open in editor <ExternalLink size={14} aria-hidden="true" />
              <span className={poolStyles.sr}>(opens in a new tab)</span>
            </a>
          </div>
          <p className={styles.activeSub}>
            {cardsText(ctl.total)} in Main, {ctl.extraTotal} in Extra{by ? ` · by ${by}` : ""}
          </p>
          <div>
            <button type="button" className={`${svButtonClass("ghost")} ${poolStyles.small}`} onClick={() => ctl.setMode("scratch")}>
              Start from scratch instead
            </button>
          </div>
        </section>
      )}
      {cubeActions && <StatusBar ctl={ctl} />}
      {ctl.cubes.length === 0 ? (
        <p className={poolStyles.loading}>No saved cubes yet. Cubes you save show up here.</p>
      ) : (
        <CubePicker
          cubes={ctl.cubes}
          userId={ctl.userId}
          selectedId={meta?.cubeId ?? null}
          hasEdits={ctl.edited}
          replaces={ctl.replacedByPick}
          picking={ctl.picking}
          error={ctl.pickError}
          keepName={null}
          onPick={(id) => void ctl.pickCube(id)}
          onKeep={ctl.closePicker}
        />
      )}
    </>
  );
}
