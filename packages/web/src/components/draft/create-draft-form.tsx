"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { DraftConfig } from "@yugidraft/shared/types";
import { CircleAlert, Check } from "lucide-react";
import { parseCustomCardIds } from "@/lib/custom-card-pool";
import { PoolBuilder } from "@/components/cards/pool-builder";
import { ArchetypeAdd } from "./create/archetype-add";
import { PoolPreview } from "./create/pool-preview";
import { poolRowText, secondsText } from "./create/format";
import styles from "./create/create.module.css";
import type { CardSummary } from "@/lib/card-types";
import {
  CARDS_PER_PLAYER_DEFAULT,
  PACK_SIZE_DEFAULT,
  PICK_SECONDS_DEFAULT,
  PackFields,
  type DraftConfigFieldsValue,
  configFromFields,
  validateFields,
} from "./draft-config-fields";

type Channel = { id: string; name: string };
type DraftTemplate = { id: number; name: string; config: DraftConfig };

export function CreateDraftForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [channelId, setChannelId] = React.useState("");
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = React.useState(true);
  const [templates, setTemplates] = React.useState<DraftTemplate[]>([]);
  const [selectedTemplateName, setSelectedTemplateName] = React.useState("");
  const [templateName, setTemplateName] = React.useState("");
  const [loadedHint, setLoadedHint] = React.useState<string | null>(null);
  const [archetypeStatus, setArchetypeStatus] = React.useState<string | null>(null);
  const [savedName, setSavedName] = React.useState<string | null>(null);
  const [nameError, setNameError] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const savedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fields, setFields] = React.useState<DraftConfigFieldsValue>({
    setNames: [],
    customCardText: "",
    cardsPerPlayerText: String(CARDS_PER_PLAYER_DEFAULT),
    packSizeText: String(PACK_SIZE_DEFAULT),
    pickSecondsText: String(PICK_SECONDS_DEFAULT),
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [poolCards, setPoolCards] = React.useState<CardSummary[]>([]);
  const [poolUnknownIds, setPoolUnknownIds] = React.useState<number[]>([]);
  const [poolLoading, setPoolLoading] = React.useState(false);

  const handlePool = React.useCallback(
    (cards: CardSummary[], unknownIds: number[], loading: boolean) => {
      setPoolCards(cards);
      setPoolUnknownIds(unknownIds);
      setPoolLoading(loading);
    },
    [],
  );

  React.useEffect(() => {
    let cancelled = false;
    setChannelsLoading(true);
    fetch("/api/discord/channels")
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setChannels(data.channels ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setChannelsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/cubes")
      .then((res) => (res.ok ? res.json() : { cubes: [] }))
      .then((data: { cubes?: Array<{ id: number; name: string; setNames?: string[]; customCardIds?: number[] }> }) => {
        if (cancelled) return;
        // Cubes carry their pool as setNames/customCardIds; surface them as loadable
        // saved pools for the shared cube draft.
        setTemplates(
          (data.cubes ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            config: { setNames: c.setNames ?? [], customCardIds: c.customCardIds ?? [] },
          })),
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Resolve a whole archetype to card ids and union them into the custom pool.
  const handleAddArchetype = async (archetype: string) => {
    setError(null);
    setArchetypeStatus(null);
    try {
      const res = await fetch("/api/cards/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archetype }),
      });
      if (!res.ok) {
        setError(`Couldn't add "${archetype}" — the card database may be unreachable.`);
        return;
      }
      const data = (await res.json()) as { cards: Array<{ id: number }> };
      const ids = data.cards.map((c) => c.id);
      setFields((f) => {
        const existing = parseCustomCardIds(f.customCardText).cardIds;
        const union = Array.from(new Set([...existing, ...ids]));
        return { ...f, customCardText: union.join("\n") };
      });
      setArchetypeStatus(`Added ${ids.length} card${ids.length === 1 ? "" : "s"} from "${archetype}".`);
    } catch {
      setError(`Couldn't add "${archetype}" — the card database may be unreachable.`);
    }
  };

  const applyTemplate = (template: DraftTemplate) => {
    const c = template.config;
    setSelectedTemplateName(template.name);
    setTemplateName(template.name);
    setFields((f) => ({
      ...f,
      setNames: c.setNames ?? [],
      customCardText: (c.customCardIds ?? []).join("\n"),
    }));
    setSavedName(null);
    const nSets = (c.setNames ?? []).length;
    const nIds = (c.customCardIds ?? []).length;
    setLoadedHint(`Loaded ${template.name}: ${poolRowText(nSets, nIds)}. Loading replaces the pool below.`);
  };

  const handleTemplateChange = (tName: string) => {
    const t = templates.find((item) => item.name === tName);
    if (t) applyTemplate(t);
  };

  const handleSaveTemplate = async () => {
    setSavedName(null);
    setError(null);
    if (!templateName.trim()) { setError("Template name is required"); return; }
    const poolError = validateFields(fields);
    if (poolError) { setError(poolError); return; }

    const { cardIds: customCardIds } = parseCustomCardIds(fields.customCardText);
    const res = await fetch("/api/cubes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: templateName.trim(), config: { setNames: fields.setNames, customCardIds } }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to save pool");
      return;
    }
    const data = (await res.json()) as { cube?: { id: number; name: string; config?: DraftConfig } };
    const cube = data.cube;
    const saved: DraftTemplate = {
      id: cube?.id ?? 0,
      name: cube?.name ?? templateName.trim(),
      config: cube?.config ?? { setNames: fields.setNames, customCardIds },
    };
    setTemplates((cur) =>
      [...cur.filter((item) => item.name !== saved.name), saved].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setSelectedTemplateName(saved.name);
    setSavedName(saved.name);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedName(null), 4000);
  };

  React.useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Draft name is required");
      setNameError(true);
      nameRef.current?.focus();
      return;
    }
    const poolError = validateFields(fields);
    if (poolError) { setError(poolError); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          channelId: channelId || undefined,
          config: configFromFields(fields),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create draft");
      }
      const draft = await res.json();
      router.push(draft.webSlug ? `/draft/${draft.webSlug}` : "/drafts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const { cardIds } = parseCustomCardIds(fields.customCardText);
  const config = configFromFields(fields);
  const unnamed = !name.trim();

  return (
    <form className="mk" onSubmit={handleSubmit}>
      <div className="min-w-0">
        {error && (
          <div className={`banner banner-bad ${styles.banner}`} role="alert">
            <CircleAlert className="ic" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}
        <div className="mk-secs">
          <section className="mk-sec" aria-labelledby="dc-d">
            <div className="mk-side">
              <h2 id="dc-d">Draft</h2>
              <p>Players see this name in Discord and on the web.</p>
            </div>
            <div className="fields">
              <div className="wide">
                <label className="label" htmlFor="draft-name">
                  Draft name
                </label>
                <input
                  ref={nameRef}
                  className={`input${nameError ? " bad" : ""}`}
                  id="draft-name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError) setNameError(false);
                  }}
                  placeholder="My Awesome Draft"
                  aria-invalid={nameError ? true : undefined}
                />
              </div>
              <div className="wide">
                <label className="label" htmlFor="draft-channel">
                  Channel
                </label>
                <select
                  className="input select"
                  id="draft-channel"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                >
                  <option value="">Default channel</option>
                  {channelsLoading ? (
                    <option disabled>Loading channels...</option>
                  ) : (
                    channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>#{ch.name}</option>
                    ))
                  )}
                </select>
                <p className="hint">The bot posts the draft here so people can join from Discord.</p>
              </div>
            </div>
          </section>

          <section className="mk-sec" aria-labelledby="dc-p">
            <div className="mk-side">
              <h2 id="dc-p">Pool</h2>
              <p>The cards everyone drafts from. Mix whole sets, whole archetypes and single passcodes.</p>
            </div>
            <div className="fields">
              <div className={`wide ${styles.load}`}>
                <div>
                  <label className="label" htmlFor="saved-pool">
                    Saved pool
                  </label>
                  <select
                    className="input select"
                    id="saved-pool"
                    value={selectedTemplateName}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                  >
                    <option value="">Choose a saved pool</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>
                {loadedHint && <p className="hint" role="status">{loadedHint}</p>}
              </div>

              <PoolBuilder
                value={{ setNames: fields.setNames, customCardText: fields.customCardText }}
                onChange={(pb) => setFields((f) => ({ ...f, setNames: pb.setNames, customCardText: pb.customCardText }))}
                showPreview={false}
                onPool={handlePool}
                afterSets={
                  <div className="wide">
                    <ArchetypeAdd
                      inputId="draft-archetype-search"
                      onSelect={(archetype) => void handleAddArchetype(archetype)}
                      hint={
                        <p className="hint">
                          Adds every card in the archetype to the passcodes below.
                          {archetypeStatus ? ` ${archetypeStatus}` : ""}
                        </p>
                      }
                    />
                  </div>
                }
              />

              <div className={`wide ${styles.save}`}>
                <div>
                  <label className="label" htmlFor="template-name">
                    Save this pool as
                  </label>
                  <input
                    className="input"
                    id="template-name"
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="Goat Cube"
                  />
                </div>
                <button className="btn btn-secondary" type="button" onClick={handleSaveTemplate}>
                  {savedName ? (
                    <>
                      <Check className="ic sm" aria-hidden="true" />
                      Saved
                    </>
                  ) : (
                    "Save pool"
                  )}
                </button>
                {savedName && (
                  <p className={styles.status} role="status">
                    Saved {savedName}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="mk-sec" aria-labelledby="dc-k">
            <div className="mk-side">
              <h2 id="dc-k">Packs</h2>
              <p>How many cards each player ends with, and how long each pick lasts.</p>
            </div>
            <PackFields value={fields} onChange={setFields} />
          </section>
        </div>
      </div>

      <aside className="sum" aria-label="Draft summary">
        <div className="card">
          <p className="card-kind">Cube draft</p>
          <p className={`sum-name${unnamed ? ` ${styles.unnamed}` : ""}`}>{unnamed ? "Untitled draft" : name.trim()}</p>
          <dl className="rows">
            <div>
              <dt>Pool</dt>
              <dd>{poolRowText(fields.setNames.length, cardIds.length)}</dd>
            </div>
            <div>
              <dt>Each player</dt>
              <dd>{config.cardsPerPlayer} cards</dd>
            </div>
            <div>
              <dt>Packs</dt>
              <dd>{config.packsPerPlayer} of {config.packSize}</dd>
            </div>
            <div>
              <dt>Pick duration</dt>
              <dd>{secondsText(config.pickSeconds ?? 0)}</dd>
            </div>
            <div>
              <dt>Seats</dt>
              <dd>Shuffled at the start</dd>
            </div>
          </dl>
          <PoolPreview cards={poolCards} unknownIds={poolUnknownIds} loading={poolLoading} />
          <ol className="next" aria-label="What happens next">
            <li><span>You get a lobby with an invite link. You&apos;re in it as a player.</span></li>
            <li><span>Players join from the link or with <code className="cmd">/draft join</code>.</span></li>
            <li><span>You press Start. Seats are shuffled and the first packs are dealt.</span></li>
          </ol>
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
            Create draft
          </button>
        </div>
      </aside>
    </form>
  );
}
