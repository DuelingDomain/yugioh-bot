"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { formatDate } from "@/lib/admin-console/time";
import type { LiveData, OnlinePerson, PersonPlace, UserKey } from "@/lib/admin-console/types";
import type { ConsoleActions } from "../admin-console";
import { kindOf, okData, type PersonKind, type Snapshots } from "../model";
import { Avatar, Icon, Since, WatchLink } from "../parts";
import { usePerson } from "../use-person";
import styles from "../admin-console.module.css";

type Filter = "all" | PersonKind;
const FILTERS: [Filter, string][] = [["all", "All"], ["duel", "In a duel"], ["draft", "Drafting"], ["other", "Other"]];

/** "Turn 5 · Ranked" for a duel, "Round 2, pick 6" for a draft, from the live list. */
function placeDetail(place: PersonPlace, live: LiveData | null): string {
  if (place.kind === "duel") {
    const duel = live?.duels.find((d) => d.slug === place.slug);
    if (!duel) return place.status === "lobby" ? "Waiting for players" : "In progress";
    if (duel.status === "lobby") return "Waiting for players";
    return [duel.turn != null ? `Turn ${duel.turn}` : "Starting", duel.ranked ? "Ranked" : "Casual", duel.genesys ? "Genesys" : null].filter(Boolean).join(" · ");
  }
  const draft = live?.drafts.find((d) => d.slug === place.slug);
  return draft?.progress ?? (place.status === "pending" ? "In the lobby" : "Drafting");
}

const KIND_ICON = { duel: "duels", draft: "draft", other: "deck" } as const;
const date = (ms: number | null) => (ms === null ? "-" : formatDate(ms));

const PHONE = "(max-width: 760px)";

function Detail({ userId, fallback, live, onClose, open }: { userId: UserKey | null; fallback: OnlinePerson | null; live: LiveData | null; onClose: () => void; open: boolean }) {
  const { person, failed, loading } = usePerson(userId);
  const closeRef = useRef<HTMLButtonElement>(null);
  // On a phone the panel is a bottom sheet: move focus into it when it opens.
  useEffect(() => {
    if (open && window.matchMedia(PHONE).matches) closeRef.current?.focus({ preventScroll: true });
  }, [open]);
  const name = person?.name ?? fallback?.name ?? "";
  if (userId === null) {
    return <aside className={`${styles.detail} ${open ? styles.detailOpen : ""}`}><p className={styles.muted}>Select a person to see where they are and what they did last.</p></aside>;
  }
  const online = person ? person.online : fallback !== null;
  const current = person?.current ?? fallback?.current ?? null;
  const since = person?.onlineSince ?? fallback?.onlineSince ?? fallback?.lastSeenAt ?? null;
  const { wins = 0, games = 0 } = person?.results ?? {};
  return (
    <aside className={`${styles.detail} ${open ? styles.detailOpen : ""}`} aria-label={`Details for ${name}`}>
      <button ref={closeRef} type="button" className={`${styles.btn} ${styles.btnSm} ${styles.detailClose}`} onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      <div className={styles.detailHead}>
        <Avatar name={name} url={person?.avatarUrl ?? fallback?.avatarUrl} size="lg" online={online} />
        <div className={styles.minw}>
          <h3>{name || "Loading"}</h3>
          <div className={styles.hd}>
            {person?.username || fallback?.username ? `@${person?.username ?? fallback?.username}` : null}
            {online ? <> · online <Since at={since} /></> : person ? <> · offline</> : null}
          </div>
        </div>
      </div>
      <div className={styles.where}>
        <div className={styles.whereK}>{online ? "Now in" : "Status"}</div>
        {current ? (
          <>
            <div className={styles.whereV}>{current.label} · {current.name}</div>
            <div className={styles.whereD}>{placeDetail(current, live)}</div>
            <div className={styles.btns}>
              <WatchLink href={`/admin/watch/${current.kind}/${current.slug}`} primary label={current.kind === "duel" ? "Watch duel" : "Watch draft"} />
            </div>
          </>
        ) : (
          <>
            <div className={styles.whereV}>{online ? (person?.label ?? fallback?.label ?? "Online") : "Offline"}</div>
            <div className={styles.whereD}>{online ? "Not in a game" : "The page and table show only while a person is online."}</div>
          </>
        )}
      </div>
      <dl className={styles.facts}>
        <div><dt>Joined</dt><dd>{person ? date(person.joinedAt) : "-"}</dd></div>
        <div><dt>Duels, 7 days</dt><dd>{person ? person.week.duels : "-"}</dd></div>
        <div><dt>Win rate, 30 days</dt><dd>{person ? (games ? <>{Math.round((wins / games) * 100)}%<small>of {games}</small></> : "-") : "-"}</dd></div>
        <div><dt>Drafts, 7 days</dt><dd>{person ? person.week.drafts : "-"}</dd></div>
      </dl>
      <div className={styles.whereK}>Recent activity</div>
      {person && person.recent.length > 0 ? (
        <ol className={styles.timeline}>
          {person.recent.map((a, i) => (
            <li key={`${a.href}-${i}`} data-tone={a.tone === "live" ? "live" : undefined}>
              <a href={a.href} target="_blank" rel="noopener"><span><b data-tone={a.tone}>{a.outcome}</b> {a.what} · {a.name}</span></a>
              <time>{a.at ? <Since at={a.at} suffix=" ago" /> : null}</time>
            </li>
          ))}
        </ol>
      ) : <p className={styles.muted} style={{ marginTop: 10 }}>{failed ? "This person could not be loaded." : loading || !person ? "Loading" : "No duels or drafts yet."}</p>}
    </aside>
  );
}

export function PeopleView({ s, actions, selected, sheetOpen, onCloseSheet, filterRef }: {
  s: Snapshots; actions: ConsoleActions; selected: UserKey | null; sheetOpen: boolean; onCloseSheet: () => void; filterRef: RefObject<HTMLInputElement | null>;
}) {
  const online = okData(s.online);
  const live = okData(s.live);
  const [filter, setFilter] = useState<Filter>("all");
  // The row that opened the phone sheet gets focus back when the sheet closes.
  const lastRow = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(sheetOpen);
  useEffect(() => {
    if (wasOpen.current && !sheetOpen && window.matchMedia(PHONE).matches) lastRow.current?.focus({ preventScroll: true });
    wasOpen.current = sheetOpen;
  }, [sheetOpen]);
  const [query, setQuery] = useState("");
  const users = useMemo(() => online?.users ?? [], [online]);
  const counts = useMemo(() => ({
    all: users.length, duel: users.filter((u) => kindOf(u) === "duel").length,
    draft: users.filter((u) => kindOf(u) === "draft").length, other: users.filter((u) => kindOf(u) === "other").length,
  }), [users]);
  const q = query.trim().toLowerCase();
  const list = users.filter((u) => (filter === "all" || kindOf(u) === filter)
    && (!q || `${u.name} ${u.username ?? ""} ${u.label} ${u.current?.name ?? ""}`.toLowerCase().includes(q)));
  const selectedId = selected ?? users[0]?.userId ?? null;
  const fallback = users.find((u) => u.userId === selectedId) ?? null;
  const selectedName = selected !== null ? (fallback?.name ?? null) : null;

  return (
    <>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Icon name="search" />
          <input ref={filterRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name or section" aria-label="Filter people" />
          <kbd className={styles.kbd}>/</kbd>
        </label>
        <div className={styles.seg} role="group" aria-label="Filter by activity">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} aria-label={`${label}, ${counts[key]}`} onClick={() => setFilter(key)}>{label}<span>{counts[key]}</span></button>
          ))}
        </div>
      </div>
      <div className={styles.peopleLayout}>
        <div className={styles.peopleTbl} role="table" aria-label="Online people">
          <div className={styles.tblHead} role="row"><span role="columnheader">Person</span><span role="columnheader">Section</span><span role="columnheader">Online for</span><span role="columnheader">Current table</span><span /></div>
          {list.length === 0 ? (
            <div className={styles.empty}>{!online ? "Loading" : users.length === 0 ? "Nobody is online right now." : "No one matches this filter."}</div>
          ) : list.map((u) => (
            <div key={u.userId} role="row" tabIndex={0} aria-selected={u.userId === selectedId} className={`${styles.tblRow} ${styles.click}`}
              onClick={(e) => { lastRow.current = e.currentTarget; actions.openPerson(u.userId); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); lastRow.current = e.currentTarget; actions.openPerson(u.userId); } }}>
              <div className={styles.cellUser} role="cell">
                <Avatar name={u.name} url={u.avatarUrl} online />
                <div className={styles.minw}>
                  <div className={styles.nm}>{u.name}</div>
                  {u.username ? <div className={styles.hd}>@{u.username}</div> : null}
                  <div className={`${styles.mOnly} ${styles.uSec}`}>{u.label}{u.current ? ` · ${u.current.name}` : ""}</div>
                </div>
              </div>
              <div className={styles.secCell} role="cell">
                <Icon name={KIND_ICON[kindOf(u)]} />
                <div className={styles.minw}>{u.label}<small>{u.current ? u.current.name : "Browsing"}</small></div>
              </div>
              <div className={styles.num} role="cell"><Since at={u.onlineSince ?? u.lastSeenAt} /></div>
              <div className={styles.cur} role="cell">
                {u.current ? (
                  <>
                    <a href={u.current.href} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>{u.current.label} · {u.current.name}</a>
                    <small>{placeDetail(u.current, live)}</small>
                  </>
                ) : <span className={styles.muted}>Not in a game</span>}
              </div>
              <div className={styles.chev} role="cell"><Icon name="chev" /></div>
            </div>
          ))}
        </div>
        <Detail userId={selectedId} fallback={fallback} live={live} open={sheetOpen} onClose={onCloseSheet} />
        {/* Only the selected name is announced: the panel itself has ticking timers and a 20 s refresh. */}
        <p className={styles.srOnly} aria-live="polite">{selectedName ? `Showing ${selectedName}` : ""}</p>
      </div>
      <div className={`${styles.scrim} ${sheetOpen ? styles.scrimOn : ""}`} onClick={onCloseSheet} aria-hidden="true" />
    </>
  );
}
