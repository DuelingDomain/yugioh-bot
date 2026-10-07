"use client";

/**
 * The Workbench: the three-pane layout of draft creation. Sources and the card preview on the left, the pool in the
 * middle, the rules and Create on the right. This file holds only the layout, the shortcuts and the help; the form
 * (`create-draft-form.tsx`) puts the real panes in.
 *
 * Three layouts, picked from the window width (the app sidebar takes room, so a container query would lie):
 *   wide   1280px and up. Three columns. The rules collapse to a thin strip (`]`). The sources collapse (`[`) and the left
 *          column then keeps the card preview alone, with a button to bring the sources back.
 *   mid    721 to 1279px. The card preview, the pool and the rules. The sources are a modal left drawer, opened with "Add cards".
 *   phone  720px and under. One pane at a time (Sources, Pool, Rules), a tab bar, and a sticky bar with Create.
 * With no `matchMedia` (a test, a server render) the layout is wide.
 *
 * Usage:
 *   const mode = useWorkbenchMode();
 *   const layout = useWorkbenchLayout(mode);
 *   <Workbench layout={layout} sources={<SourceRail drawer=... />} pool={...} rules={<RulesPanel />} dock={...} onCreate={...} />
 *
 * Shortcuts (not while typing, and not while a dialog or the card sheet is open): / search cards, F filter the pool,
 * [ and ] hide the sources or the rules, ? this help. Ctrl+Enter (or Cmd+Enter) creates, also inside a field.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Keyboard, Layers, Plus, Search, SlidersHorizontal } from "lucide-react";
import { BugFabLift } from "@/components/bug-report/fab-lift";
import { OwnsPageBar, ShellMenuButton } from "@/components/layout/shell-bar";
import { PageBar, SheetRoot, SvButton } from "@/components/sheet";
import { tileImage } from "./pool-browser-model";
import styles from "./workbench.module.css";

export type WorkbenchMode = "wide" | "mid" | "phone";
export type PhoneTab = "sources" | "pool" | "rules";

const PHONE_QUERY = "(max-width: 720px)";
const WIDE_QUERY = "(min-width: 1280px)";

const hasMatchMedia = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

function modeNow(): WorkbenchMode {
  if (!hasMatchMedia()) return "wide";
  if (window.matchMedia(PHONE_QUERY).matches) return "phone";
  return window.matchMedia(WIDE_QUERY).matches ? "wide" : "mid";
}

function subscribeMode(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {};
  const queries = [window.matchMedia(PHONE_QUERY), window.matchMedia(WIDE_QUERY)];
  queries.forEach((q) => q.addEventListener?.("change", onChange));
  return () => queries.forEach((q) => q.removeEventListener?.("change", onChange));
}

/** The layout for the current window width. Wide on the server and until the browser answers. */
export function useWorkbenchMode(): WorkbenchMode {
  return React.useSyncExternalStore(subscribeMode, modeNow, () => "wide");
}

export interface WorkbenchLayout {
  mode: WorkbenchMode;
  /** Wide: the left column is a thin strip. */
  sourcesCollapsed: boolean;
  /** Wide: the right column is a thin strip. */
  rulesCollapsed: boolean;
  /** Mid: the sources drawer is open. Always false in the other layouts. */
  drawerOpen: boolean;
  /** Phone: the pane on screen. */
  phoneTab: PhoneTab;
  /** Shows the sources in any layout: expands the column, opens the drawer or switches the phone tab. */
  openSources: () => void;
  closeSources: () => void;
  /** `[`: collapses or expands the column (wide), opens or closes the drawer (mid). Nothing on a phone. */
  toggleSources: () => void;
  /** `]`: collapses or expands the rules column (wide). */
  toggleRules: () => void;
  collapseSources: () => void;
  expandRules: () => void;
  setPhoneTab: (tab: PhoneTab) => void;
}

export function useWorkbenchLayout(mode: WorkbenchMode): WorkbenchLayout {
  const [sourcesCollapsed, setSourcesCollapsed] = React.useState(false);
  const [rulesCollapsed, setRulesCollapsed] = React.useState(false);
  const [drawer, setDrawer] = React.useState(false);
  const [phoneTab, setPhoneTab] = React.useState<PhoneTab>("pool");
  const drawerOpen = mode === "mid" && drawer;

  return React.useMemo<WorkbenchLayout>(() => {
    const openSources = () => {
      if (mode === "wide") setSourcesCollapsed(false);
      else if (mode === "mid") setDrawer(true);
      else setPhoneTab("sources");
    };
    return {
      mode,
      sourcesCollapsed: mode === "wide" && sourcesCollapsed,
      rulesCollapsed: mode === "wide" && rulesCollapsed,
      drawerOpen,
      phoneTab,
      openSources,
      closeSources: () => {
        if (mode === "mid") setDrawer(false);
        else if (mode === "phone") setPhoneTab("pool");
      },
      toggleSources: () => {
        if (mode === "wide") setSourcesCollapsed((v) => !v);
        else if (mode === "mid") setDrawer((v) => !v);
      },
      toggleRules: () => {
        if (mode === "wide") setRulesCollapsed((v) => !v);
      },
      collapseSources: () => setSourcesCollapsed(true),
      expandRules: () => setRulesCollapsed(false),
      setPhoneTab,
    };
  }, [mode, sourcesCollapsed, rulesCollapsed, drawerOpen, phoneTab]);
}

/** Class for the source rail while its mid-width drawer is closed: it hides the rail once it has slid out of sight. */
export const DRAWER_SHUT_CLASS: string = styles.shut;

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && typeof el.matches === "function" && el.matches("input, textarea, select, [contenteditable='true'], [contenteditable='']");
};

/** Sets `--wb-top` (distance from the top of the page) and `--topH` (distance from the top of the sheet) on the element. */
function useTopOffset(ref: React.RefObject<HTMLElement | null>) {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const sheet = el.closest(".ms");
      el.style.setProperty("--wb-top", `${Math.round(rect.top + window.scrollY)}px`);
      el.style.setProperty("--topH", `${Math.round(sheet ? rect.top - sheet.getBoundingClientRect().top : rect.top)}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    const bar = el.previousElementSibling;
    const observer = typeof ResizeObserver === "undefined" || !bar ? null : new ResizeObserver(measure);
    if (bar) observer?.observe(bar);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [ref]);
}

export interface WorkbenchProps {
  layout: WorkbenchLayout;
  /** The `SourceRail`. The form gives it the drawer and the collapse button that match the layout. */
  sources: React.ReactNode;
  /** Shown above the pool: the import rows. */
  banner?: React.ReactNode;
  /** The pool browser. */
  pool: React.ReactNode;
  /** The card preview. Shown as its own left column when the sources are not in the left column (mid width, or wide with the sources collapsed). */
  preview?: React.ReactNode;
  /** The rules panel. */
  rules: React.ReactNode;
  /** Pool tab badge on a phone. */
  poolCount?: number;
  /** The dot on the collapsed rules strip and the phone Rules tab. */
  tone: "ok" | "bad";
  /** Wide, rules collapsed: the Create action shown in the thin strip. */
  stripAction?: React.ReactNode;
  /** Phone: the sticky bar above the tabs (a summary and the Create button). */
  dock?: React.ReactNode;
  /** Ctrl+Enter. */
  onCreate: () => void;
  /** `/`: put the cursor in the card search. */
  onSearchCards: () => void;
  /** `F`: put the cursor in the pool filter. */
  onFocusFilter: () => void;
  className?: string;
}

const HELP_ROWS: ReadonlyArray<[keys: string[], text: string]> = [
  [["/"], "Search cards to add"],
  [["F"], "Filter this pool"],
  [["←", "↑", "→", "↓"], "Move between cards"],
  [["+", "−"], "More or fewer copies of the card you are on"],
  [["Del"], "Remove the card you are on"],
  [["Esc"], "Unpin the card preview"],
  [["G"], "Grid or list"],
  [["M", "E"], "Main lane or Extra lane"],
  [["[", "]"], "Hide the sources or the rules"],
  [["Ctrl", "↵"], "Create the draft"],
];

export function Workbench({ layout, sources, banner, pool, preview, rules, poolCount, tone, stripAction, dock, onCreate, onSearchCards, onFocusFilter, className }: WorkbenchProps) {
  const { mode } = layout;
  const wide = mode === "wide";
  const phone = mode === "phone";
  const docked = !!preview && (mode === "mid" || (wide && layout.sourcesCollapsed));
  const ref = React.useRef<HTMLDivElement>(null);
  useTopOffset(ref);
  const [help, setHelp] = React.useState(false);
  const helpButton = React.useRef<HTMLButtonElement>(null);

  const latest = React.useRef({ layout, onCreate, onSearchCards, onFocusFilter });
  latest.current = { layout, onCreate, onSearchCards, onFocusFilter };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const now = latest.current;
      const modal = document.querySelector('[aria-modal="true"]') !== null;
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        if (modal) return;
        e.preventDefault();
        now.onCreate();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || modal || isTypingTarget(e.target)) return;
      switch (e.key) {
        case "/":
          e.preventDefault();
          now.onSearchCards();
          return;
        case "?":
          e.preventDefault();
          setHelp(true);
          return;
        case "[":
          now.layout.toggleSources();
          return;
        case "]":
          now.layout.toggleRules();
          return;
        case "f":
        case "F":
          // The pool browser handles F itself while focus is inside it.
          if ((e.target as HTMLElement | null)?.closest?.("[data-wb-pool]")) return;
          e.preventDefault();
          now.onFocusFilter();
          return;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const tab = layout.phoneTab;
  const rulesHidden = phone ? tab !== "rules" : false;
  const toneLabel = tone === "ok" ? "Ready" : "Needs a change";

  return (
    <div
      ref={ref}
      className={`${styles.wb}${className ? ` ${className}` : ""}`}
      data-mode={mode}
      data-sources={layout.sourcesCollapsed ? "off" : undefined}
      data-rules={layout.rulesCollapsed ? "off" : undefined}
      data-preview={docked ? "" : undefined}
      data-tab={phone ? tab : undefined}
    >
      <div className={styles.srcCol} hidden={phone && tab !== "sources"}>
        {docked && (
          <div className={styles.prevCol}>
            <div className={styles.prevHead}>
              <h2>Card</h2>
              {wide && (
                <button type="button" className={styles.iconBtn} aria-label="Show sources" title="Show sources ([)" onClick={layout.openSources}>
                  <ChevronRight size={17} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className={styles.prevBody}>{preview}</div>
          </div>
        )}
        {wide && layout.sourcesCollapsed && !docked && (
          <div className={styles.strip} data-side="left">
            <button type="button" className={styles.stripBtn} aria-label="Show sources" title="Show sources ([)" onClick={layout.openSources}>
              <ChevronRight size={17} aria-hidden="true" />
            </button>
            <span className={styles.stripLabel} aria-hidden="true">Sources</span>
          </div>
        )}
        <div className={styles.srcHost} hidden={wide && layout.sourcesCollapsed}>
          {sources}
        </div>
      </div>

      <section className={styles.poolCol} aria-label="Draft pool" hidden={phone && tab !== "pool"}>
        {mode === "mid" && (
          <div className={styles.addRow}>
            <button type="button" className={styles.addBtn} onClick={layout.openSources} aria-haspopup="dialog" aria-expanded={layout.drawerOpen}>
              <Plus size={16} aria-hidden="true" />
              Add cards
            </button>
          </div>
        )}
        {banner && <div className={styles.banner}>{banner}</div>}
        <div className={styles.poolHost} data-wb-pool>
          {pool}
        </div>
      </section>

      <aside className={styles.rulesCol} aria-label="Draft rules and Create" hidden={rulesHidden}>
        {wide && layout.rulesCollapsed ? (
          <div className={styles.strip} data-side="right">
            <button type="button" className={styles.stripBtn} aria-label="Show rules" title="Show rules (])" onClick={layout.toggleRules}>
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
            <i className={styles.dot} data-tone={tone} title={toneLabel} role="img" aria-label={toneLabel} />
            <span className={styles.stripLabel} aria-hidden="true">Draft rules</span>
            {stripAction && <div className={styles.stripAction}>{stripAction}</div>}
          </div>
        ) : (
          <>
            {!phone && (
              <header className={styles.rulesHead}>
                <h2>Draft rules</h2>
                <button ref={helpButton} type="button" className={styles.iconBtn} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelp(true)}>
                  <Keyboard size={17} aria-hidden="true" />
                </button>
                {wide && (
                  <button type="button" className={styles.iconBtn} aria-label="Collapse rules" title="Collapse ( ] )" onClick={layout.toggleRules}>
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                )}
              </header>
            )}
            <div className={styles.rulesBody}>{rules}</div>
          </>
        )}
      </aside>

      {phone && (
        <BugFabLift className={styles.dockWrap}>
          {dock}
          <nav className={styles.tabs} aria-label="Workbench panes">
            <button type="button" aria-current={tab === "sources" ? "page" : undefined} onClick={() => layout.setPhoneTab("sources")}>
              <Search size={18} aria-hidden="true" />
              Sources
            </button>
            <button type="button" aria-current={tab === "pool" ? "page" : undefined} onClick={() => layout.setPhoneTab("pool")}>
              <Layers size={18} aria-hidden="true" />
              Pool
              {poolCount !== undefined && poolCount > 0 && <b className={styles.badge}>{poolCount.toLocaleString("en-US")}</b>}
            </button>
            <button type="button" aria-current={tab === "rules" ? "page" : undefined} onClick={() => layout.setPhoneTab("rules")}>
              <SlidersHorizontal size={18} aria-hidden="true" />
              Rules
              <i className={styles.dot} data-tone={tone} title={toneLabel} role="img" aria-label={toneLabel} />
            </button>
          </nav>
        </BugFabLift>
      )}

      {help && <HelpDialog onClose={() => { setHelp(false); helpButton.current?.focus(); }} />}
    </div>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  React.useEffect(() => setHost(document.body), []);
  React.useEffect(() => {
    if (!host) return;
    box.current?.querySelector<HTMLElement>("[data-done]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [host, onClose]);
  if (!host) return null;
  return createPortal(
    <SheetRoot flow>
      <div className={styles.helpLayer}>
        <button type="button" className={styles.helpScrim} tabIndex={-1} aria-label="Close keyboard help" onClick={onClose} />
        <div
          ref={box}
          className={styles.help}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              // One control in the dialog: Tab stays on it.
              e.preventDefault();
              box.current?.querySelector<HTMLElement>("[data-done]")?.focus();
            }
          }}
        >
          <h2 id={titleId}>Keyboard</h2>
          <dl>
            {HELP_ROWS.map(([keys, text]) => (
              <React.Fragment key={text}>
                <dt>
                  {keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </dt>
                <dd>{text}</dd>
              </React.Fragment>
            ))}
          </dl>
          <div className={styles.helpFoot}>
            <SvButton data-done="" onClick={onClose}>
              Got it
            </SvButton>
          </div>
        </div>
      </div>
    </SheetRoot>,
    host,
  );
}

/** The phone's sticky bar: the sum against the pool on the left, the Create button on the right. */
export function WorkbenchDock({ total, detail, tone, error, children }: { total: React.ReactNode; detail: React.ReactNode; tone: "ok" | "bad"; error?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={styles.dock}>
      {error && (
        <p className={styles.dockError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.dockRow}>
        <div className={styles.dockSum} data-tone={tone}>
          <b>{total}</b>
          <span>{detail}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The Create button. `icon` is the small button of the collapsed rules strip, `dock` the one in the phone bar. */
export function WorkbenchCreate({ disabled, busy, onClick, kind = "full" }: { disabled: boolean; busy: boolean; onClick: () => void; kind?: "full" | "icon" | "dock" }) {
  if (kind === "icon") {
    return (
      <SvButton variant="primary" aria-label="Create draft" title="Create draft (Ctrl+Enter)" disabled={disabled} aria-busy={busy || undefined} onClick={onClick} className={styles.createIcon}>
        <Check size={18} aria-hidden="true" />
      </SvButton>
    );
  }
  if (kind === "dock") {
    return (
      <SvButton variant="primary" big disabled={disabled} aria-busy={busy || undefined} onClick={onClick}>
        Create draft
      </SvButton>
    );
  }
  return (
    <SvButton variant="primary" big wide disabled={disabled} aria-busy={busy || undefined} onClick={onClick}>
      Create draft
      <kbd className={styles.createKey} aria-hidden="true">
        Ctrl ↵
      </kbd>
    </SvButton>
  );
}

/** An API error above the Create button. */
export function WorkbenchError({ children }: { children: React.ReactNode }) {
  return (
    <p className={styles.error} role="alert">
      {children}
    </p>
  );
}

const SAMPLE_ART = [46986414, 89631139, 53129443];

/** What the pool shows before it holds a card. The buttons take the user to the source that fits. */
export function WorkbenchEmpty({ onList, onCubes, onSearch }: { onList: () => void; onCubes: () => void; onSearch: () => void }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyArt} aria-hidden="true">
        {SAMPLE_ART.map((id) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={id} src={tileImage(id)} alt="" decoding="async" />
        ))}
      </div>
      <h2>Start with a card list</h2>
      <p>
        Paste a list or load a <b>.txt</b> or <b>.ydk</b> file in the List source. The whole list loads in one step. Section titles and bad lines are skipped for you.
      </p>
      <div className={styles.emptyActs}>
        <SvButton variant="primary" onClick={onList}>
          Add a card list
        </SvButton>
        <SvButton onClick={onCubes}>Use a saved cube</SvButton>
        <SvButton variant="quiet" onClick={onSearch}>
          Search cards <kbd>/</kbd>
        </SvButton>
      </div>
      <p className={styles.emptyHint}>Names, passcodes and .ydk all work.</p>
    </div>
  );
}

/**
 * The page around the Workbench: the sheet root, the page bar with the shell menu button for a phone, and nothing
 * else. The Workbench takes the rest of the screen height, so the page does not scroll.
 */
export function WorkbenchFrame({ back, title, sub, children }: { back?: { href: string; label: string }; title: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <SheetRoot className={styles.frame}>
      <OwnsPageBar room />
      <PageBar back={back} title={title} sub={sub} actions={<ShellMenuButton />} />
      {children}
    </SheetRoot>
  );
}
