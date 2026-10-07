"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import type { DraftAllowedCube } from "@yugidraft/shared/types";
import { ListImportReport } from "@/components/card-list-import/list-import-report";
import { CubeListImportPanel, type ImportedCube } from "@/components/cubes/cube-list-import-panel";
import { nextCubeName } from "@/components/cubes/library-model";
import { StatusLine, svButtonClass } from "@/components/sheet";
import { listAddedLine } from "@/lib/card-list-import";
import type { CubeDraftType } from "@/lib/cube-type";
import { cn } from "@/lib/utils";
import type { LobbyController } from "../lobby/lobby-actions";
import { ThemeMenu } from "../lobby/theme-menu";
import { themeRequest, type ThemeTable } from "./use-theme-table";
import styles from "./theme-table.module.css";

interface LibraryCube {
  id: number;
  name: string;
  archetype: string | null;
  mainCount: number;
  extraCount: number;
  draftType?: CubeDraftType;
}

export interface ThemeBoxProps {
  slug: string;
  cubes: DraftAllowedCube[];
  table: ThemeTable;
  controller: LobbyController;
  isHost: boolean;
  /** The viewer holds a seat and may take a theme (players pick). */
  canTake: boolean;
  /** The viewer's own theme, to mark it. */
  yourCubeId: number | null;
  onPreview: (cubeId: number) => void;
  /** After a library change that the draft page does not see. */
  onChanged: () => void;
}

const different = (n: number) => `${n} different`;
const copies = (n: number) => `${n} ${n === 1 ? "copy" : "copies"}`;

/** One cube in the box: pictures, name, the distinct and copy counts, who holds it, and what you can do with it. */
function BoxCube({ cube, table, controller, isHost, canTake, yourCubeId, slug, onPreview, onChanged }: { cube: DraftAllowedCube } & Omit<ThemeBoxProps, "cubes">) {
  const holder = table.holderOf(cube.id);
  const mine = yourCubeId === cube.id;
  const busy = controller.pending !== null;
  const images = cube.sampleImages.slice(0, 3);
  const taken = holder !== null && !mine && table.unique;
  const showHolder = table.selection === "player_pick" && holder !== null;

  const remove = async () => {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${cube.name}" from your library for good? This can't be undone.`)) return;
    await controller.run("detach", async () => {
      await themeRequest(`/api/drafts/${encodeURIComponent(slug)}/cubes`, "DELETE", { cubeId: cube.id });
      await themeRequest(`/api/cubes/${cube.id}`, "DELETE");
      onChanged();
    }, "Couldn't delete that theme.");
  };

  return (
    <li className={styles.cube} data-mine={mine ? "true" : undefined} data-taken={taken ? "true" : undefined}>
      {images.length > 0 && (
        <span className={styles.fan} aria-hidden="true">
          {images.map((src, i) => <img key={i} src={src} alt="" loading="lazy" />)}
        </span>
      )}
      <span className={styles.cubeText}>
        <span className={styles.cubeName}>{cube.name}</span>
        {cube.archetype && cube.archetype !== cube.name && <span className={styles.cubeSub}>{cube.archetype}</span>}
        <span className={styles.cubeCounts}>
          <span><b>Main</b> {different(cube.mainDistinct)}, {copies(cube.mainCopies)}</span>
          <span><b>Extra</b> {different(cube.extraDistinct)}, {copies(cube.extraCopies)}</span>
        </span>
        {showHolder && (
          <span className={styles.cubeHolder} data-mine={mine ? "true" : undefined}>
            {mine ? "Your theme" : `Taken by ${holder.displayName}`}
          </span>
        )}
      </span>
      <span className={styles.cubeActs}>
        <button type="button" className={cn(svButtonClass("ghost"), styles.smallBtn)} aria-label={`See the cards in ${cube.name}`} onClick={() => onPreview(cube.id)}>
          See cards
        </button>
        {canTake && table.selection === "player_pick" && !mine && (
          <button
            type="button"
            className={cn(svButtonClass("primary"), styles.smallBtn)}
            aria-label={`Take ${cube.name}`}
            disabled={busy || taken}
            onClick={() => void table.claim(cube.id)}
          >
            {taken ? "Taken" : "Take"}
          </button>
        )}
        {isHost && (
          <>
            <Link
              className={cn(svButtonClass("quiet"), styles.smallBtn)}
              href={`/cubes/${cube.id}?from=${encodeURIComponent(`/draft/${slug}`)}`}
              aria-label={`Edit cube ${cube.name}`}
            >
              Edit
            </Link>
            <ThemeMenu name={cube.name} busy={busy} onDetach={() => void table.detach(cube.id)} onDelete={() => void remove()} />
          </>
        )}
      </span>
    </li>
  );
}

/** The host's tools: find an archetype, use a saved cube, start a blank one, import a list. Only the host sees them. */
function BoxTools({ cubes, table, controller, onChanged }: Pick<ThemeBoxProps, "cubes" | "table" | "controller" | "onChanged">) {
  const ids = React.useId();
  const [query, setQuery] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [blankName, setBlankName] = React.useState("");
  const [showBlank, setShowBlank] = React.useState(false);
  const [attachId, setAttachId] = React.useState("");
  const [library, setLibrary] = React.useState<LibraryCube[]>([]);
  const [importing, setImporting] = React.useState(false);
  const [imported, setImported] = React.useState<ImportedCube | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const reqId = React.useRef(0);
  const busy = controller.pending !== null;

  const attachedIds = React.useMemo(() => new Set(cubes.map((c) => c.id)), [cubes]);
  const attachable = library.filter((c) => !attachedIds.has(c.id) && c.draftType !== "booster");

  const loadLibrary = React.useCallback(() => {
    fetch("/api/cubes")
      .then((res) => (res.ok ? res.json() : { cubes: [] }))
      .then((data: { cubes?: LibraryCube[] }) => setLibrary(data.cubes ?? []))
      .catch(() => {});
  }, []);
  React.useEffect(() => loadLibrary(), [loadLibrary]);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setSuggestions([]); return; }
    const mine = ++reqId.current;
    const t = setTimeout(() => {
      fetch(`/api/archetypes?query=${encodeURIComponent(q)}`)
        .then((res) => (res.ok ? res.json() : { archetypes: [] }))
        .then((data: { archetypes?: string[] }) => { if (mine === reqId.current) setSuggestions((data.archetypes ?? []).slice(0, 8)); })
        .catch(() => { if (mine === reqId.current) setSuggestions([]); });
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const add = async (body: Parameters<ThemeTable["attach"]>[0], line: string, savedName?: string) => {
    setInfo(null);
    const cube = await table.attach(body, savedName === undefined ? undefined : { savedName });
    if (!cube) return;
    setInfo(line);
    setQuery(""); setBlankName(""); setAttachId(""); setSuggestions([]);
    loadLibrary();
  };
  const addArchetype = (name: string) => {
    const archetype = name.trim();
    if (archetype) void add({ kind: "archetype", archetype }, `Added "${archetype}" to the box.`);
  };

  // A list becomes a saved theme cube first, then joins the draft like any saved cube. A failed join keeps the cube.
  const importList = async (result: ImportedCube) => {
    setImporting(false);
    setInfo(null);
    const cube = await table.attach({ kind: "existing", cubeId: result.cube.id }, { savedName: result.cube.name });
    loadLibrary();
    if (cube) setImported(result);
  };

  const recovery = table.recovery;
  return (
    <div className={styles.tools} role="group" aria-label="Add a theme">
      <h3 className={styles.toolsT}>Add a theme <small>only you see this</small></h3>
      {info && <p className={styles.toolsInfo} role="status">{info}</p>}
      {recovery && (
        <div role="alert" className={styles.recovery}>
          <StatusLine tone="warn">
            {recovery.name ? `"${recovery.name}" is saved in your library, but it did not join this draft.` : "The cube is saved in your library, but it did not join this draft."}
            {" "}{recovery.message}
          </StatusLine>
          <span className={styles.recoveryActs}>
            <button type="button" className={cn(svButtonClass("ghost"), styles.smallBtn)} disabled={busy} onClick={() => void add({ kind: "existing", cubeId: recovery.cubeId }, `Added "${recovery.name ?? "the cube"}" to the box.`, recovery.name ?? undefined)}>
              Try adding it again
            </button>
            <button type="button" className={cn(svButtonClass("quiet"), styles.smallBtn)} onClick={table.clearRecovery}>Keep it in the library</button>
          </span>
        </div>
      )}

      <div className={styles.toolRow}>
        <label className="label" htmlFor={`${ids}-arch`}>Search an archetype</label>
        <div className={styles.toolIn}>
          <span className={styles.search}>
            <Search size={16} aria-hidden="true" />
            <input
              id={`${ids}-arch`}
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy && query.trim()) { e.preventDefault(); addArchetype(query); }
                else if (e.key === "Escape") setSuggestions([]);
              }}
              placeholder="Blue-Eyes, Dark Magician"
              autoComplete="off"
            />
            {suggestions.length > 0 && (
              <span className={styles.suggest}>
                {suggestions.map((name) => <button key={name} type="button" onClick={() => addArchetype(name)}>{name}</button>)}
              </span>
            )}
          </span>
          <button type="button" className={cn(svButtonClass("ghost"), styles.smallBtn)} disabled={busy || query.trim().length === 0} onClick={() => addArchetype(query)}>
            <Plus size={15} aria-hidden="true" />Add
          </button>
        </div>
      </div>

      {attachable.length > 0 && (
        <div className={styles.toolRow}>
          <label className="label" htmlFor={`${ids}-att`}>Or use a saved cube</label>
          <div className={styles.toolIn}>
            <select id={`${ids}-att`} aria-label="Attach an existing cube" className="input select" value={attachId} disabled={busy} onChange={(e) => setAttachId(e.target.value)}>
              <option value="">Choose a cube</option>
              {attachable.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.archetype ? ` (${c.archetype})` : ""} - {c.mainCount} main, {c.extraCount} extra</option>
              ))}
            </select>
            <button
              type="button"
              className={cn(svButtonClass("ghost"), styles.smallBtn)}
              disabled={busy || !attachId}
              onClick={() => void add({ kind: "existing", cubeId: Number(attachId) }, `Added "${attachable.find((c) => String(c.id) === attachId)?.name ?? "the cube"}" to the box.`)}
            >
              Attach
            </button>
          </div>
        </div>
      )}

      {showBlank && (
        <div className={styles.toolIn}>
          <input
            className="input"
            aria-label="Blank cube name"
            value={blankName}
            onChange={(e) => setBlankName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy && blankName.trim()) { e.preventDefault(); void add({ kind: "blank", name: blankName.trim() }, `Added blank cube "${blankName.trim()}".`); }
            }}
            placeholder="Custom cube name (e.g. Stun)"
            autoFocus
          />
          <button type="button" className={cn(svButtonClass("ghost"), styles.smallBtn)} disabled={busy || blankName.trim().length === 0} onClick={() => void add({ kind: "blank", name: blankName.trim() }, `Added blank cube "${blankName.trim()}".`)}>
            Add blank cube
          </button>
        </div>
      )}

      {importing && (
        <CubeListImportPanel
          defaultName={nextCubeName(library.map((c) => c.name))}
          fixedType="theme"
          onCreated={importList}
          onCancel={() => setImporting(false)}
        />
      )}
      {imported && (
        <div role="status" aria-label="Imported theme">
          <p className={styles.toolsInfo}>Added <b>{imported.cube.name}</b> to this draft. {listAddedLine(imported.added, imported.copies)}</p>
          <ListImportReport {...imported} />
        </div>
      )}

      <p className={styles.toolsNote}>
        Each archetype becomes its own cube in your library. You can edit it before the start.{" "}
        {!showBlank && <button className="link" type="button" onClick={() => setShowBlank(true)}>Start a blank cube</button>}{" "}
        {!importing && <button className="link" type="button" onClick={() => { setImported(null); setImporting(true); }}>Import a list</button>}
      </p>
    </div>
  );
}

/**
 * The box: the theme cubes of the draft. Everyone sees the cubes, their counts and the whole pool of each. Players pick
 * a cube here with Take; the host also adds, edits and removes them.
 */
export function ThemeBox(props: ThemeBoxProps) {
  const { cubes, isHost } = props;
  return (
    <section className={styles.box} aria-labelledby="theme-box-h">
      <header className={styles.boxLid}>
        <p className={styles.eyebrow}>The box</p>
        <h2 id="theme-box-h" className={styles.boxT}>Theme cubes</h2>
        <span className={styles.boxSub}>{cubes.length === 0 ? "No themes yet" : `${cubes.length} ${cubes.length === 1 ? "theme" : "themes"} in the box`}</span>
      </header>
      <div className={styles.boxBody}>
        {cubes.length === 0 ? (
          <p className={styles.boxEmpty}>{isHost ? "Search an archetype or add a blank cube to start." : "The host has not added a theme yet."}</p>
        ) : (
          <ul className={styles.cubes}>
            {cubes.map((cube) => <BoxCube key={cube.id} cube={cube} {...props} />)}
          </ul>
        )}
        {isHost && <BoxTools cubes={cubes} table={props.table} controller={props.controller} onChanged={props.onChanged} />}
      </div>
    </section>
  );
}
