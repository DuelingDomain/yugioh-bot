"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { StatusLine, SvButton } from "@/components/sheet";
import { DraftLayout, DraftMain, DraftRail, Num, RailSection, Rules } from "./draft-frame";
import { PoolPreview } from "./create/pool-preview";
import { secondsText } from "./create/format";
import styles from "./create/create.module.css";
import { PoolEditor } from "./pool/pool-editor";
import { PoolRailValue, SeatNote } from "./pool/pool-rail";
import { usePoolEditor } from "./pool/use-pool-editor";
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

export function CreateDraftForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [channelId, setChannelId] = React.useState("");
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = React.useState(true);
  const [nameError, setNameError] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const [fields, setFields] = React.useState<DraftConfigFieldsValue>({
    cardsPerPlayerText: String(CARDS_PER_PLAYER_DEFAULT),
    packSizeText: String(PACK_SIZE_DEFAULT),
    pickSecondsText: String(PICK_SECONDS_DEFAULT),
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pool = usePoolEditor({ variant: "create" });

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Draft name is required");
      setNameError(true);
      nameRef.current?.focus();
      return;
    }
    if (pool.loading) return;
    if (pool.pool.size === 0) {
      setError("Add cards to the pool first");
      return;
    }
    const packError = validateFields(fields);
    if (packError) { setError(packError); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          channelId: channelId || undefined,
          config: { ...configFromFields(fields), ...pool.config(), includeNames: [], excludeNames: [] },
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

  const config = configFromFields(fields);
  const unnamed = !name.trim();
  const previewCards = React.useMemo<CardSummary[]>(() => {
    const out: CardSummary[] = [];
    for (const [id, copies] of pool.pool) {
      const card = pool.info(id);
      if (card) out.push({ ...card, qty: copies });
    }
    return out;
  }, [pool.pool, pool.info]);

  return (
    <DraftLayout as="form" onSubmit={handleSubmit}>
      <DraftMain>
        {error && (
          <div role="alert" className={styles.alert}>
            <StatusLine tone="block">{error}</StatusLine>
          </div>
        )}
        <div className={styles.sections}>
          <section className={styles.sec} aria-labelledby="dc-d">
            <div className={styles.secSide}>
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
                  placeholder="Friday cube night"
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

          <section className={styles.sec} aria-labelledby="dc-p">
            <div className={styles.secSide}>
              <h2 id="dc-p">Pool</h2>
              <p>The cards everyone drafts from. Start from a cube or build one here.</p>
            </div>
            <div className="fields">
              <div className="wide">
                <PoolEditor ctl={pool} />
              </div>
            </div>
          </section>

          <section className={styles.sec} aria-labelledby="dc-k">
            <div className={styles.secSide}>
              <h2 id="dc-k">Packs</h2>
              <p>How many cards each player ends with, and how long each pick lasts.</p>
            </div>
            <PackFields value={fields} onChange={setFields} />
          </section>
        </div>
      </DraftMain>

      <DraftRail
        aria-label="Draft summary"
        actions={
          <SvButton type="submit" variant="primary" big wide disabled={submitting || pool.loading} aria-busy={submitting || pool.loading || undefined}>
            Create draft
          </SvButton>
        }
      >
        <RailSection>
          <p className={styles.railKind}>Cube draft</p>
          <p className={`${styles.railName}${unnamed ? ` ${styles.unnamed}` : ""}`}>{unnamed ? "Untitled draft" : name.trim()}</p>
          <Rules
            rows={[
              { label: "Pool", value: <PoolRailValue ctl={pool} /> },
              { label: "Each player", value: <><Num>{config.cardsPerPlayer}</Num> cards</> },
              { label: "Packs", value: <><Num>{config.packsPerPlayer}</Num> of <Num>{config.packSize}</Num></> },
              { label: "Pick duration", value: secondsText(config.pickSeconds ?? 0) },
              { label: "Seats", value: "Shuffled at the start" },
            ]}
          />
          <SeatNote total={pool.total} perPlayer={config.packsPerPlayer * config.packSize} />
        </RailSection>
        <RailSection>
          <PoolPreview cards={previewCards} unknownIds={[]} loading={!pool.ready} />
        </RailSection>
        <RailSection title="What happens next">
          <ol className={styles.steps} aria-label="What happens next">
            <li><span>You get a lobby with an invite link. You&apos;re in it as a player.</span></li>
            <li><span>Players join from the link or with <code className="cmd">/draft join</code>.</span></li>
            <li><span>You press Start. Seats are shuffled and the first packs are dealt.</span></li>
          </ol>
        </RailSection>
      </DraftRail>
    </DraftLayout>
  );
}
