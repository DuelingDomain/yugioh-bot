"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { FloorList, FloorRow, SectionHead, StatusLine, SvButton } from "@/components/sheet";
import { botPosts, type PostDestination } from "./announcement-posts";
import styles from "./settings.module.css";

type GuildSettings = {
  guildId: string;
  announceDraftCreated: boolean;
  announceDraftStarted: boolean;
  announceDraftCompleted: boolean;
  announceTournamentCreated: boolean;
  announceTournamentCompleted: boolean;
  announceChannelId: string | null;
};

type Channel = {
  id: string;
  name: string;
};

function Destination({ to }: { to: PostDestination }) {
  switch (to.kind) {
    case "channel":
      return <span className={styles.dest}>#{to.name}</span>;
    case "default":
      return <span className={styles.dest}>{to.text}</span>;
    case "none":
      return <span className={styles.destOff}>Not posted</span>;
    case "off":
      return <span className={styles.destOff}>Not posted</span>;
  }
}

export function AnnouncementToggles() {
  // The last saved settings object. A save sends all of it back, so the stored
  // announce* booleans are never touched.
  const [settings, setSettings] = React.useState<GuildSettings | null>(null);
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [channelId, setChannelId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    Promise.all([
      fetch("/api/settings").then((r) => {
        if (!r.ok) throw new Error("settings");
        return r.json() as Promise<GuildSettings>;
      }),
      fetch("/api/discord/channels").then((r) => r.json()).catch(() => ({ channels: [] })),
    ])
      .then(([settingsData, channelsData]) => {
        if (cancelled) return;
        setSettings(settingsData);
        setChannelId(settingsData.announceChannelId ?? null);
        setChannels(channelsData.channels ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  React.useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(timer);
  }, [saved]);

  const nameFor = (id: string | null): string | null => {
    if (!id) return null;
    return channels.find((c) => c.id === id)?.name ?? null;
  };

  const handleSave = async () => {
    if (!settings || saving) return;
    setSaving(true);
    setSaveFailed(false);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, announceChannelId: channelId }),
      });
      if (res.ok) {
        const updated = (await res.json()) as GuildSettings;
        setSettings(updated);
        setChannelId(updated.announceChannelId ?? null);
        setSaved(true);
      } else {
        setSaveFailed(true);
      }
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className={styles.block} aria-busy="true" aria-label="Loading announcement settings">
        <span className="sk" style={{ width: "30%" }} />
        <span className="sk" style={{ width: "62%", height: 36 }} />
        <span className="sk" style={{ width: "70%" }} />
        <span className="sk" style={{ width: "56%" }} />
        <span className="sk" style={{ width: "64%" }} />
      </div>
    );
  } else if (loadFailed || !settings) {
    body = (
      <div className={styles.loadError}>
        <div role="alert">
          <StatusLine tone="block">
            <b>Couldn&apos;t load announcement settings.</b> Try again in a moment.
          </StatusLine>
        </div>
        <SvButton variant="quiet" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </SvButton>
      </div>
    );
  } else {
    const savedId = settings.announceChannelId ?? null;
    const changed = channelId !== savedId;
    const savedName = nameFor(savedId);
    const shownName = nameFor(channelId);
    const knownIds = new Set(channels.map((c) => c.id));
    const posts = botPosts(channelId ? (shownName ?? "the chosen channel") : null);
    body = (
      <div className={styles.block}>
        <SectionHead as="h3" title="Announcement channel" note="one per server" />
        <div className={styles.channel}>
          <label className="label" htmlFor="an-ch">Post to</label>
          <div className={styles.inline}>
            <select
              className="input select"
              id="an-ch"
              value={channelId ?? ""}
              aria-describedby={saveFailed ? "an-ch-err" : undefined}
              onChange={(e) => {
                setChannelId(e.target.value || null);
                setSaved(false);
                setSaveFailed(false);
              }}
            >
              <option value="">None</option>
              {channelId && !knownIds.has(channelId) && <option value={channelId}>Current channel</option>}
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  #{ch.name}
                </option>
              ))}
            </select>
            <SvButton variant="primary" disabled={!changed || saving} aria-busy={saving || undefined} onClick={() => void handleSave()}>
              Save
            </SvButton>
            {saved && (
              <span className={styles.saved} role="status">
                <Check size={15} aria-hidden="true" />
                Saved
              </span>
            )}
          </div>
          {changed && !saveFailed && (
            <p className={styles.rowNote}>
              Was {savedId ? `#${savedName ?? "the current channel"}` : "none"}. Nothing moves until you save.
            </p>
          )}
          {!changed && !saved && channelId && (
            <p className={styles.rowNote}>
              Results waiting for approval, finished tournaments and tournament announcements post here.
            </p>
          )}
          {saveFailed && (
            <div id="an-ch-err" role="alert">
              <StatusLine tone="block">
                Couldn&apos;t save. {savedId ? `Posts still go to #${savedName ?? "the current channel"}.` : "Nothing has changed."}
              </StatusLine>
            </div>
          )}
        </div>

        {!channelId && (
          <StatusLine tone="warn">
            <b>Two kinds of post are skipped.</b>{" "}
            Results waiting for approval and finished tournaments aren&apos;t posted anywhere until you choose a channel.
          </StatusLine>
        )}

        <SectionHead as="h3" title="What the bot posts" note="and where" />
        <FloorList>
          {posts.map((post) => (
            <FloorRow key={post.key} className={styles.postRow}>
              <div className="sv-cell-grow">
                <p className={styles.rowTitle}>{post.title}</p>
                <p className={styles.rowNote}>{post.when}</p>
              </div>
              <span className={`sv-cell-end ${styles.destCell}`}>
                <Destination to={post.to} />
              </span>
            </FloorRow>
          ))}
        </FloorList>
      </div>
    );
  }

  return (
    <section className="set-sec" aria-labelledby="set-ann">
      <div className="set-intro">
        <h2 id="set-ann">Announcements</h2>
        <p>
          Where the bot posts in Discord. The list is what it actually does today, so nothing here promises a post that
          never comes.
        </p>
      </div>
      {body}
    </section>
  );
}
