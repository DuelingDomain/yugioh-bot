"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Box, Layers, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { MetaLine } from "@/components/meta-line/meta-line";
import { SheetRoot } from "@/components/sheet";
import { isDraftTemplate, nextCubeName, type AddTab, type CubeSummary } from "./library-model";
import styles from "./cubes.module.css";

const MAX_SET_NAMES = 4;

function DeleteConfirm({
  cube,
  busy,
  onDelete,
  onKeep,
}: {
  cube: CubeSummary;
  busy: boolean;
  onDelete: () => void;
  onKeep: () => void;
}) {
  const keepRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => keepRef.current?.focus(), []);
  return (
    <div className={`cb-confirm ${styles.confirm}`} role="alertdialog" aria-label={`Delete ${cube.name}`}>
      <span>Delete {cube.name} for everyone on the server?</span>
      <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={onDelete}>
        Delete
      </button>
      <button ref={keepRef} className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={onKeep}>
        Keep
      </button>
    </div>
  );
}

function CubeRow({
  cube,
  confirming,
  busy,
  onAskDelete,
  onDelete,
  onKeep,
}: {
  cube: CubeSummary;
  confirming: boolean;
  busy: boolean;
  onAskDelete: () => void;
  onDelete: () => void;
  onKeep: () => void;
}) {
  const template = isDraftTemplate(cube);
  const sets = cube.setNames ?? [];
  const rowClass = `cb-row ${styles.row}`;

  const actions = confirming ? (
    <DeleteConfirm cube={cube} busy={busy} onDelete={onDelete} onKeep={onKeep} />
  ) : (
    <div className={`cb-acts ${styles.acts}`}>
      {!template && (
        <Link className="btn btn-secondary btn-sm" href={`/cubes/${cube.id}`} aria-label={`Open ${cube.name}`}>
          Open
        </Link>
      )}
      <button
        className="ib danger"
        type="button"
        aria-label={`Delete ${cube.name}`}
        disabled={busy}
        onClick={onAskDelete}
      >
        <Trash2 className="ic" aria-hidden="true" />
      </button>
    </div>
  );

  if (template) {
    return (
      <li className={rowClass} data-template data-confirm={confirming || undefined}>
        <div>
          <span className="nm">{cube.name}</span>
          <MetaLine
            className="mt"
            items={[
              { content: <span>Draft template</span> },
              { content: <span>{sets.length} {sets.length === 1 ? "set" : "sets"}</span> },
            ]}
          />
          <MetaLine
            className={`mt ${styles.setNames}`}
            items={[
              ...sets.slice(0, MAX_SET_NAMES).map((set) => ({ content: <span>{set}</span> })),
              ...(sets.length > MAX_SET_NAMES ? [{ content: <span>+{sets.length - MAX_SET_NAMES} more</span> }] : []),
            ]}
          />
          <p className={styles.tmplNote}>
            <Layers className="ic sm" aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 6 }} />
            Used by <code>/draft</code>. Booster sets, not a pool, so there are no cards to edit.
          </p>
        </div>
        {actions}
      </li>
    );
  }

  return (
    <li className={rowClass} data-confirm={confirming || undefined}>
      <div>
        <Link className={`nm ${styles.openLink}`} href={`/cubes/${cube.id}`}>
          {cube.name}
        </Link>
        <MetaLine
          className="mt"
          items={[
            {
              content: cube.archetype ? (
                <span>Seeded from <b>{cube.archetype}</b></span>
              ) : (
                <span>Built by hand</span>
              ),
            },
            ...(cube.banlist ? [{ content: <span>{cube.banlist} banlist</span> }] : []),
          ]}
        />
        <p className="mt">
          <span>
            Main <b>{cube.mainCount}</b> cards
          </span>
          <span>
            Extra <b>{cube.extraCount}</b> cards
          </span>
        </p>
      </div>
      {actions}
    </li>
  );
}

export function CubesLibraryList() {
  const router = useRouter();
  const [cubes, setCubes] = React.useState<CubeSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmId, setConfirmId] = React.useState<number | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    fetch("/api/cubes")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((data: { cubes: CubeSummary[] }) => {
        setCubes(data.cubes ?? []);
        setLoading(false);
      })
      .catch(() => {
        setLoadFailed(true);
        setLoading(false);
      });
  }, []);

  React.useEffect(() => load(), [load]);

  const deleteCube = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cubes/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Failed to delete cube.");
        return;
      }
      setCubes((cur) => cur.filter((c) => c.id !== id));
      setConfirmId(null);
    } finally {
      setBusy(false);
    }
  };

  const create = async (body: Record<string, unknown>, tab?: AddTab) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cubes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { cube?: { id: number }; error?: string };
      if (!res.ok || !data.cube) {
        setError(data.error ?? "Failed to create cube.");
        return;
      }
      router.push(`/cubes/${data.cube.id}${tab ? `?add=${tab}` : ""}`);
    } finally {
      setBusy(false);
    }
  };

  // Create a fresh blank cube (auto-named to avoid collisions) and jump straight
  // into its editor, where the user names it and builds the pool.
  const addCube = (tab?: AddTab) => {
    void create({ kind: "blank", name: nextCubeName(cubes.map((c) => c.name)) }, tab);
  };

  return (
    <SheetRoot>
      <header className="page-h sheet-head">
        <div>
          <h1 className="t-title">Cubes</h1>
          <p className="page-sub">
            Reusable card pools for cube drafts and Theme Drafts. Anyone on the server can edit them.
          </p>
        </div>
        <button className="btn btn-primary" type="button" disabled={busy || loading} onClick={() => addCube()}>
          <Plus className="ic sm" aria-hidden="true" />
          New cube
        </button>
      </header>

      {error && (
        <div className={`banner banner-bad ${styles.err}`} role="alert">
          <TriangleAlert className="ic" aria-hidden="true" />
          <div>{error}</div>
        </div>
      )}

      {loading ? (
        <div className="cb-list" aria-busy="true" aria-label="Loading cubes">
          {[46, 38].map((w) => (
            <div key={w} className={`cb-row ${styles.row}`}>
              <div style={{ display: "grid", gap: 10 }}>
                <span className="sk" style={{ width: `${w}%`, height: 14 }} />
                <span className="sk" style={{ width: `${w + 24}%` }} />
              </div>
              <span className="cb-acts">
                <span className="sk" style={{ width: 64, height: 30 }} />
              </span>
            </div>
          ))}
        </div>
      ) : loadFailed ? (
        <div className="banner banner-bad" role="alert">
          <TriangleAlert className="ic" aria-hidden="true" />
          <div>
            <b>Couldn&apos;t load your cubes.</b> Check your connection and try again.
          </div>
          <button className="btn btn-secondary btn-sm" type="button" style={{ marginLeft: "auto" }} onClick={load}>
            <RotateCcw className="ic sm" aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : cubes.length === 0 ? (
        <div className="empty" style={{ padding: "36px 20px" }}>
          <Box className="ic" aria-hidden="true" />
          <h2>No cubes yet</h2>
          <p>
            A cube is a pool you draft from. Start from an archetype, paste a list of passcodes, or pick cards one at a
            time.
          </p>
          <div className={`acts ${styles.startActs}`}>
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => addCube("archetype")}>
              From an archetype
            </button>
            <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => addCube("passcodes")}>
              From passcodes
            </button>
            <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => addCube()}>
              Blank cube
            </button>
          </div>
        </div>
      ) : (
        <ul className="cb-list" aria-label="Cubes">
          {cubes.map((cube) => (
            <CubeRow
              key={cube.id}
              cube={cube}
              confirming={confirmId === cube.id}
              busy={busy}
              onAskDelete={() => setConfirmId(cube.id)}
              onDelete={() => void deleteCube(cube.id)}
              onKeep={() => setConfirmId(null)}
            />
          ))}
        </ul>
      )}
    </SheetRoot>
  );
}
