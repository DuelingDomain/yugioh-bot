"use client";

import * as React from "react";
import Link from "next/link";
import { splitPreflight } from "@/components/draft/lobby/lobby-model";
import { ThemeMenu } from "@/components/draft/lobby/theme-menu";
import styles from "@/components/draft/lobby/lobby.module.css";

interface AllowedCube {
  id: number;
  name: string;
  archetype: string | null;
  mainCount: number;
  extraCount: number;
  sampleImages: string[];
}

export interface CubeHostTools {
  busy: boolean;
  onDetach: (cubeId: number) => void;
  onDelete: (cubeId: number, name: string) => void;
}

interface CubeLobbyPanelProps {
  slug: string;
  allowedCubes: AllowedCube[];
  themeSelection: "host_assigned" | "random" | "player_pick";
  onClaimed?: () => void;
  /** Joined players (the host included) can claim a theme. Default true. */
  canClaim?: boolean;
  uniqueThemes?: boolean;
  /** Host-only: Edit cube link and the Detach / Delete menu on each theme. */
  hostTools?: CubeHostTools;
  /** Rendered under the theme cards (the host's "Add a theme" panel). */
  children?: React.ReactNode;
}

/** The Themes section of a theme draft's lobby: readiness banners, theme cards, and claims. */
export function CubeLobbyPanel({
  slug,
  allowedCubes,
  themeSelection,
  onClaimed,
  canClaim = true,
  uniqueThemes = true,
  hostTools,
  children,
}: CubeLobbyPanelProps) {
  const [claiming, setClaiming] = React.useState<number | null>(null);
  const [claimedName, setClaimedName] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [preflight, setPreflight] = React.useState<{ errors: string[]; warnings: string[] } | null>(null);
  const headingId = React.useId();

  // Re-check when the set of themes (or their sizes) changes, so the banners never describe a theme that's gone.
  const cubesKey = allowedCubes.map((c) => `${c.id}:${c.mainCount}:${c.extraCount}`).join(",");
  React.useEffect(() => {
    let live = true;
    fetch(`/api/drafts/${slug}/preflight`)
      .then((res) => (res.ok ? res.json() : { errors: [], warnings: [] }))
      .then((data) => {
        if (live) setPreflight(data);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [slug, cubesKey]);

  const claim = async (cubeId: number, name: string) => {
    setClaiming(cubeId);
    setError(null);
    try {
      const res = await fetch(`/api/drafts/${slug}/claim-cube`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cubeId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setClaimedName(null);
        setError(data.error ?? "Could not claim cube");
        return;
      }
      setClaimedName(name);
      onClaimed?.();
    } finally {
      setClaiming(null);
    }
  };

  const names = allowedCubes.map((c) => c.name);
  const warnedNames = new Set((preflight?.warnings ?? []).map((w) => splitPreflight(w, names).name));
  const pickMode = themeSelection === "player_pick";
  const showClaim = pickMode && canClaim;

  const aux = [
    `${allowedCubes.length} ${allowedCubes.length === 1 ? "theme" : "themes"}`,
    uniqueThemes && allowedCubes.length > 0 ? "each player gets a different one" : null,
    showClaim ? "claim yours" : null,
  ].filter(Boolean).join(" · ");

  const message = (text: string) => {
    const { name, rest } = splitPreflight(text, names);
    return name ? <><b>{name}:</b> {rest}</> : <>{text}</>;
  };

  return (
    <section aria-labelledby={headingId}>
      <div className="sec-h">
        <h2 className="sec-t" id={headingId}>Themes</h2>
        <span className="sec-aux">{aux}</span>
      </div>

      {preflight?.errors.length ? (
        <div className="banner banner-bad" role="alert">
          <div>{preflight.errors.map((e, i) => <p key={i}>{message(e)}</p>)}</div>
        </div>
      ) : null}
      {preflight?.warnings.length ? (
        <div className="banner banner-warn" role="status" style={{ marginTop: preflight.errors.length ? 10 : 0 }}>
          <div>
            {preflight.warnings.map((w, i) => <p key={i}>{message(w)}</p>)}
            <p>You can edit the cube or start anyway.</p>
          </div>
        </div>
      ) : null}
      {error && <div className="banner banner-bad" role="alert" style={{ marginTop: 10 }}><p>{error}</p></div>}

      {themeSelection === "random" && (
        <p className="small" style={{ marginTop: 12 }}>Themes are dealt at random when the host presses Start.</p>
      )}
      {showClaim && (
        <p className={styles.live} role="status" aria-live="polite" style={{ marginTop: 12, marginBottom: 0 }}>
          {claimedName ? `You claimed ${claimedName}. Claim another to switch.` : ""}
        </p>
      )}

      {allowedCubes.length === 0 ? (
        <p className="small" style={{ margin: "12px 0" }}>
          {hostTools ? "No themes yet. Search an archetype below or add a blank cube to start." : "No themes yet."}
        </p>
      ) : (
        <ul className={styles.themes}>
          {allowedCubes.map((cube) => {
            const images = cube.sampleImages.slice(0, 3);
            return (
              <li key={cube.id} className={styles.th} data-warn={warnedNames.has(cube.name) ? "" : undefined} data-nofan={images.length === 0 ? "" : undefined}>
                {images.length > 0 && (
                  <span className={styles.fan} aria-hidden="true">
                    {images.map((src, i) => <img key={i} src={src} alt="" loading="lazy" />)}
                  </span>
                )}
                <span className={styles.thn}>{cube.name}</span>
                <span className={styles.thm}>{cube.mainCount} main · {cube.extraCount} extra</span>
                {showClaim && (
                  <span className={styles.thx}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      aria-label={`Claim ${cube.name}`}
                      onClick={() => void claim(cube.id, cube.name)}
                      disabled={claiming !== null}
                    >
                      {claiming === cube.id ? "Claiming…" : "Claim"}
                    </button>
                  </span>
                )}
                {hostTools && (
                  <span className={styles.tha}>
                    <Link
                      className="btn btn-quiet btn-sm"
                      href={`/cubes/${cube.id}?from=${encodeURIComponent(`/draft/${slug}`)}`}
                      aria-label={`Edit cube ${cube.name}`}
                    >
                      Edit cube
                    </Link>
                    <ThemeMenu
                      name={cube.name}
                      busy={hostTools.busy}
                      onDetach={() => hostTools.onDetach(cube.id)}
                      onDelete={() => hostTools.onDelete(cube.id, cube.name)}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {children}
    </section>
  );
}
