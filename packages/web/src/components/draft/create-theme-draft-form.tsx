"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { DraftConfig } from "@yugidraft/shared/types";
import { StatusLine, SvButton, SvCheck } from "@/components/sheet";
import { DraftLayout, DraftMain, DraftRail, Num, RailSection, Rules } from "./draft-frame";
import { secondsText, themeSelectionText } from "./create/format";
import styles from "./create/create.module.css";

type Channel = { id: string; name: string };

export function CreateThemeDraftForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [channelId, setChannelId] = React.useState("");
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [themePackSize, setThemePackSize] = React.useState(3);
  const [cardsPerPlayer, setCardsPerPlayer] = React.useState(40);
  const [extraDeckEnabled, setExtraDeckEnabled] = React.useState(true);
  const [extraDeckSize, setExtraDeckSize] = React.useState(15);
  const [copyLimit, setCopyLimit] = React.useState(true);
  const [burnUnpicked, setBurnUnpicked] = React.useState(false);
  const [uniqueThemes, setUniqueThemes] = React.useState(true);
  const [themeSelection, setThemeSelection] = React.useState<"player_pick" | "random">("player_pick");
  const [pickSeconds, setPickSeconds] = React.useState(45);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [nameError, setNameError] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    fetch("/api/discord/channels")
      .then((res) => res.json())
      .then((data) => setChannels(data.channels ?? []))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Draft name is required");
      setNameError(true);
      nameRef.current?.focus();
      return;
    }
    const config: DraftConfig = {
      mode: "theme",
      allowedCubeIds: [],
      themePackSize,
      cardsPerPlayer,
      extraDeckEnabled,
      extraDeckSize,
      burnUnpicked,
      copyLimit,
      uniqueThemes,
      themeSelection,
      pickSeconds,
    };
    setSubmitting(true);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), channelId: channelId || undefined, config }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create theme draft");
      }
      const draft = await res.json();
      // Land in the draft, where you build its theme cubes.
      router.push(draft.webSlug ? `/draft/${draft.webSlug}` : "/drafts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const unnamed = !name.trim();

  return (
    <DraftLayout as="form" onSubmit={handleSubmit}>
      <DraftMain>
        {error && (
          <div role="alert" className={styles.alert}>
            <StatusLine tone="block">{error}</StatusLine>
          </div>
        )}
        <div className={styles.sections}>
          <section className={styles.sec} aria-labelledby="dt-d">
            <div className={styles.secSide}>
              <h2 id="dt-d">Draft</h2>
              <p>Players see this name in Discord and on the web.</p>
            </div>
            <div className="fields">
              <div className="wide">
                <label className="label" htmlFor="theme-draft-name">
                  Draft name
                </label>
                <input
                  ref={nameRef}
                  className={`input${nameError ? " bad" : ""}`}
                  id="theme-draft-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError) setNameError(false);
                  }}
                  placeholder="Theme night"
                  aria-invalid={nameError ? true : undefined}
                />
              </div>
              <div className="wide">
                <label className="label" htmlFor="theme-draft-channel">
                  Channel
                </label>
                <select
                  className="input select"
                  id="theme-draft-channel"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                >
                  <option value="">Default channel</option>
                  {channels.map((ch) => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}
                </select>
                <p className="hint">The bot posts the draft here so people can join from Discord.</p>
              </div>
            </div>
          </section>

          <section className={styles.sec} aria-labelledby="dt-t">
            <div className={styles.secSide}>
              <h2 id="dt-t">Themes</h2>
              <p>Who drafts which archetype.</p>
            </div>
            <div className="fields">
              <fieldset className={`wide ${styles.fieldset}`}>
                <legend className="label">Theme selection</legend>
                <div className={styles.zoneOpts}>
                  <label className={styles.zoneOpt}>
                    <input
                      type="radio"
                      name="theme-selection"
                      value="player_pick"
                      checked={themeSelection === "player_pick"}
                      onChange={() => setThemeSelection("player_pick")}
                    />
                    <b>Players pick</b>
                    <span>Players claim a theme in the lobby. Anyone who hasn&apos;t claimed one gets one at the start.</span>
                  </label>
                  <label className={styles.zoneOpt}>
                    <input
                      type="radio"
                      name="theme-selection"
                      value="random"
                      checked={themeSelection === "random"}
                      onChange={() => setThemeSelection("random")}
                    />
                    <b>Random</b>
                    <span>Themes are dealt at random when you press Start.</span>
                  </label>
                </div>
              </fieldset>
              <label className={`wide ${styles.check}`}>
                <input type="checkbox" checked={uniqueThemes} onChange={(e) => setUniqueThemes(e.target.checked)} />
                <span>
                  <b>Every player gets a different theme</b>
                  You need at least one theme per player.
                </span>
              </label>
            </div>
          </section>

          <section className={styles.sec} aria-labelledby="dt-p">
            <div className={styles.secSide}>
              <h2 id="dt-p">Picks</h2>
              <p>Each pick shows a few cards from your own theme. You take one.</p>
            </div>
            <div className={`fields ${styles.three}`}>
              <div>
                <label className="label" htmlFor="theme-main-size">Main deck size</label>
                <input className="input" id="theme-main-size" type="number" inputMode="numeric" min={20} value={cardsPerPlayer} onChange={(e) => setCardsPerPlayer(Number(e.target.value))} />
              </div>
              <div>
                <label className="label" htmlFor="theme-pack-size">Choices per pick</label>
                <input className="input" id="theme-pack-size" type="number" inputMode="numeric" min={2} value={themePackSize} onChange={(e) => setThemePackSize(Number(e.target.value))} />
              </div>
              <div>
                <label className="label" htmlFor="theme-pick-seconds">Pick duration</label>
                <span className={styles.unit}>
                  <input className="input" id="theme-pick-seconds" type="number" inputMode="numeric" min={5} value={pickSeconds} onChange={(e) => setPickSeconds(Number(e.target.value))} />
                  <span aria-hidden="true">seconds</span>
                </span>
              </div>
              <label className={`wide ${styles.check}`}>
                <input type="checkbox" checked={extraDeckEnabled} onChange={(e) => setExtraDeckEnabled(e.target.checked)} />
                <span>
                  <b>Draft an Extra deck</b>
                  After the main deck, everyone drafts Extra deck cards from their theme.
                </span>
              </label>
              <div>
                <label className="label" htmlFor="theme-extra-size">Extra deck size</label>
                <input className="input" id="theme-extra-size" type="number" inputMode="numeric" min={1} disabled={!extraDeckEnabled} value={extraDeckSize} onChange={(e) => setExtraDeckSize(Number(e.target.value))} />
              </div>
              <label className={`wide ${styles.check}`}>
                <input type="checkbox" checked={burnUnpicked} onChange={(e) => setBurnUnpicked(e.target.checked)} />
                <span>
                  <b>Burn unpicked choices</b>
                  Cards you pass on are gone for the rest of the draft. Off, they can come back in a later pick.
                </span>
              </label>
              <SvCheck
                className="wide"
                prominent
                label="Limit 3 copies per card"
                hint="Players can't take a 4th copy of any card."
                checked={copyLimit}
                onChange={(e) => setCopyLimit(e.target.checked)}
              />
            </div>
          </section>
        </div>
      </DraftMain>

      <DraftRail
        aria-label="Draft summary"
        actions={
          <SvButton type="submit" variant="primary" big wide disabled={submitting} aria-busy={submitting || undefined}>
            Create theme draft
          </SvButton>
        }
      >
        <RailSection>
          <p className={styles.railKind}>Theme draft</p>
          <p className={`${styles.railName}${unnamed ? ` ${styles.unnamed}` : ""}`}>{unnamed ? "Untitled draft" : name.trim()}</p>
          <Rules
            rows={[
              { label: "Themes", value: themeSelectionText(themeSelection, uniqueThemes) },
              { label: "Main deck", value: <><Num>{cardsPerPlayer}</Num> picks</> },
              { label: "Extra deck", value: extraDeckEnabled ? <><Num>{extraDeckSize}</Num> picks</> : "Not drafted" },
              { label: "Each pick", value: <><Num>{themePackSize}</Num> choices</> },
              { label: "Pick duration", value: secondsText(pickSeconds) },
              { label: "Passed cards", value: burnUnpicked ? "Gone for good" : "Can come back" },
            ]}
          />
        </RailSection>
        <RailSection title="What happens next">
          <ol className={styles.steps} aria-label="What happens next">
            <li><span>You get a lobby. Add one theme cube per archetype there.</span></li>
            {themeSelection === "random" ? (
              <>
                <li><span>Players join.</span></li>
                <li><span>You press Start. Everyone gets a random theme and drafts at once, main deck first.</span></li>
              </>
            ) : (
              <>
                <li><span>Players join and claim a theme.</span></li>
                <li><span>You press Start. Everyone drafts at once, main deck first.</span></li>
              </>
            )}
          </ol>
        </RailSection>
      </DraftRail>
    </DraftLayout>
  );
}
