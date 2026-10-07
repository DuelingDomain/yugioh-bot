"use client";

import * as React from "react";
import { Plus, Search } from "lucide-react";
import type { CubeDraftType } from "@/lib/cube-type";
import { ListImportReport } from "@/components/card-list-import/list-import-report";
import { listAddedLine } from "@/lib/card-list-import";
import { CubeListImportPanel, type ImportedCube } from "./cube-list-import-panel";
import { nextCubeName } from "./library-model";
import { CubeLobbyPanel } from "./cube-lobby-panel";
import styles from "@/components/draft/lobby/lobby.module.css";

interface AllowedCube {
  id: number;
  name: string;
  archetype: string | null;
  mainCount: number;
  extraCount: number;
  sampleImages?: string[];
  /** Absent in an old response: a cube with no type is "any". */
  draftType?: CubeDraftType;
}

interface CubeDraftBuilderProps {
  slug: string;
  allowedCubes: AllowedCube[];
  uniqueThemes: boolean;
  onChanged: () => void;
  themeSelection?: "host_assigned" | "random" | "player_pick";
  /** Whether the host has joined the draft and so can claim a theme like anyone else. */
  canClaim?: boolean;
  copyLimit?: boolean;
}

/** The host's Themes section: the shared theme cards with host tools, plus the "Add a theme" panel. */
export function CubeDraftBuilder({
  slug,
  allowedCubes,
  uniqueThemes,
  onChanged,
  themeSelection = "player_pick",
  canClaim = false,
  copyLimit = true,
}: CubeDraftBuilderProps) {
  const [query, setQuery] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [blankName, setBlankName] = React.useState("");
  const [showBlank, setShowBlank] = React.useState(false);
  const [attachId, setAttachId] = React.useState("");
  const [library, setLibrary] = React.useState<AllowedCube[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [imported, setImported] = React.useState<ImportedCube | null>(null);
  const reqId = React.useRef(0);
  const ids = React.useId();

  // Existing library cubes that aren't already in this draft. A theme draft takes theme cubes and
  // plain ones; a cube made for cube drafts (booster) stays out of the list.
  const attachedIds = React.useMemo(() => new Set(allowedCubes.map((c) => c.id)), [allowedCubes]);
  const attachable = library.filter((c) => !attachedIds.has(c.id) && c.draftType !== "booster");

  const loadLibrary = React.useCallback(() => {
    fetch("/api/cubes")
      .then((res) => (res.ok ? res.json() : { cubes: [] }))
      .then((data: { cubes: AllowedCube[] }) => setLibrary(data.cubes ?? []))
      .catch(() => {});
  }, []);

  React.useEffect(() => loadLibrary(), [loadLibrary]);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const myReq = ++reqId.current;
    const t = setTimeout(() => {
      fetch(`/api/archetypes?query=${encodeURIComponent(q)}`)
        .then((res) => (res.ok ? res.json() : { archetypes: [] }))
        .then((data: { archetypes: string[] }) => {
          if (myReq === reqId.current) setSuggestions((data.archetypes ?? []).slice(0, 8));
        })
        .catch(() => {
          if (myReq === reqId.current) setSuggestions([]);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const post = async (body: Record<string, unknown>, successInfo: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/drafts/${slug}/cubes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          res.status === 502
            ? `${data.error ?? "Couldn't reach the card database."} You can still add a blank cube and import passcodes in its editor.`
            : data.error ?? "Failed to add cube",
        );
        return;
      }
      setInfo(successInfo);
      setQuery("");
      setBlankName("");
      setAttachId("");
      setSuggestions([]);
      onChanged();
      loadLibrary();
    } finally {
      setBusy(false);
    }
  };

  const addArchetype = (name: string) => {
    const archetype = name.trim();
    if (!archetype) return;
    void post({ kind: "archetype", archetype }, `Added "${archetype}" — seeding its cards…`);
  };

  const addBlank = () => {
    if (!blankName.trim()) return;
    void post({ kind: "blank", name: blankName.trim() }, `Added blank cube "${blankName.trim()}".`);
  };

  const attachExisting = (cubeId: number) => {
    if (!cubeId) return;
    const cube = library.find((c) => c.id === cubeId);
    void post({ kind: "existing", cubeId }, `Attached "${cube?.name ?? "cube"}".`);
  };

  // A list becomes a saved theme cube first (POST /api/cubes), then joins this draft like any saved cube.
  const importList = async (result: ImportedCube) => {
    setError(null);
    setInfo(null);
    const res = await fetch(`/api/drafts/${slug}/cubes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "existing", cubeId: result.cube.id }),
    });
    const data = await res.json().catch(() => ({}));
    setImporting(false);
    if (!res.ok) {
      setError(`Made "${result.cube.name}" in your library, but couldn't add it to this draft. ${data.error ?? ""} You can attach it from the saved cubes list.`.trim());
      loadLibrary();
      return;
    }
    setImported(result);
    onChanged();
    loadLibrary();
  };

  const detach = async (cubeId: number) => {
    setBusy(true);
    setError(null);
    try {
      await fetch(`/api/drafts/${slug}/cubes`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cubeId }),
      });
      onChanged();
      loadLibrary();
    } finally {
      setBusy(false);
    }
  };

  const deleteCube = async (cubeId: number, name: string) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${name}" from your library for good? This can't be undone.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Detach from this draft, then delete the cube from the library.
      await fetch(`/api/drafts/${slug}/cubes`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cubeId }),
      });
      await fetch(`/api/cubes/${cubeId}`, { method: "DELETE" });
      onChanged();
      loadLibrary();
    } finally {
      setBusy(false);
    }
  };

  return (
    <CubeLobbyPanel
      slug={slug}
      allowedCubes={allowedCubes as Array<AllowedCube & { sampleImages: string[] }>}
      themeSelection={themeSelection}
      uniqueThemes={uniqueThemes}
      canClaim={canClaim}
      copyLimit={copyLimit}
      onClaimed={onChanged}
      hostTools={{ busy, onDetach: (id) => void detach(id), onDelete: (id, name) => void deleteCube(id, name) }}
    >
      <div className={`panel panel-pad ${styles.addth}`} role="group" aria-label="Add a theme">
        <h3 className="panel-t"><span>Add a theme</span><small>only you see this</small></h3>

        {error && <div className="banner banner-bad" role="alert"><p>{error}</p></div>}
        {info && <p className="small" role="status">{info}</p>}

        <div className={styles.addrow}>
          <div>
            <label className="label" htmlFor={`${ids}-arch`}>Search archetype</label>
            <div className={styles.search}>
              <span className={styles.in}>
                <Search className="ic sm" aria-hidden="true" />
                <input
                  id={`${ids}-arch`}
                  className="input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy && query.trim()) {
                      e.preventDefault();
                      addArchetype(query);
                    } else if (e.key === "Escape") {
                      setSuggestions([]);
                    }
                  }}
                  placeholder="Blue-Eyes, Dark Magician"
                  autoComplete="off"
                />
                {suggestions.length > 0 && (
                  <div className={styles.suggest}>
                    {suggestions.map((name) => (
                      <button key={name} type="button" onClick={() => addArchetype(name)}>{name}</button>
                    ))}
                  </div>
                )}
              </span>
              <button type="button" className="btn btn-secondary" disabled={busy || query.trim().length === 0} onClick={() => addArchetype(query)}>
                <Plus className="ic sm" aria-hidden="true" />Add
              </button>
            </div>
          </div>

          {attachable.length > 0 && (
            <div>
              <label className="label" htmlFor={`${ids}-att`}>Or use a saved cube</label>
              <div className={styles.search}>
                <select
                  id={`${ids}-att`}
                  aria-label="Attach an existing cube"
                  className="input select"
                  value={attachId}
                  onChange={(e) => setAttachId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">Choose a cube</option>
                  {attachable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.archetype ? ` (${c.archetype})` : ""} — {c.mainCount} main, {c.extraCount} extra
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary" disabled={busy || !attachId} onClick={() => attachExisting(Number(attachId))}>
                  Attach
                </button>
              </div>
            </div>
          )}
        </div>

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
            <p className="small">
              Added <b>{imported.cube.name}</b> to this draft. {listAddedLine(imported.added, imported.copies)}
            </p>
            <ListImportReport unknown={imported.unknown} corrected={imported.corrected} />
          </div>
        )}

        {showBlank && (
          <div className={styles.blank}>
            <input
              className="input"
              aria-label="Blank cube name"
              value={blankName}
              onChange={(e) => setBlankName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy && blankName.trim()) {
                  e.preventDefault();
                  addBlank();
                }
              }}
              placeholder="Custom cube name (e.g. Stun)"
              autoFocus
            />
            <button type="button" className="btn btn-secondary" disabled={busy || blankName.trim().length === 0} onClick={addBlank}>
              <Plus className="ic sm" aria-hidden="true" />Add blank cube
            </button>
          </div>
        )}

        <p className="small">
          Each archetype becomes its own cube in your library, and you can edit it before the start.{" "}
          {!showBlank && <button className="link" type="button" onClick={() => setShowBlank(true)}>Start a blank cube</button>}{" "}
          {!importing && (
            <button className="link" type="button" onClick={() => { setImported(null); setImporting(true); }}>
              Import a list
            </button>
          )}
        </p>
      </div>
    </CubeLobbyPanel>
  );
}
