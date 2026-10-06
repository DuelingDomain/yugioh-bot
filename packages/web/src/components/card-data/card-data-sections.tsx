"use client";

import * as React from "react";
import type { CardDataStatus, EngineDataSource, UpstreamSourceStatus } from "@yugidraft/shared/types";
import { FloorList, FloorRow, StatusLine, SvButton, type StatusTone } from "@/components/sheet";
import { cardImageUrl } from "@/lib/card-image-url";
import {
  SOURCE_LABEL,
  SOURCE_ORDER,
  absoluteDate,
  absoluteTime,
  commitUrl,
  filterGap,
  isSourceBehind,
  isSourceUnknown,
  newUpstreamCdbFiles,
  relativeTime,
  shortSha,
  sortGap,
} from "@/lib/card-data-status-model";
import styles from "./card-data.module.css";

const GAP_PAGE = 25;
const FILTER_DELAY_MS = 250;

/** Screen reader hint for links that leave the app. */
function NewTab() {
  return <>{" "}<span className="sv-sr">(opens in a new tab)</span></>;
}

function When({ iso, now }: { iso: string | null; now: number }) {
  const rel = relativeTime(iso, now);
  const abs = absoluteTime(iso);
  if (!rel || !abs) return <span className={styles.mute}>unknown</span>;
  return (
    <time dateTime={iso ?? undefined} title={abs}>
      {rel} <span className={styles.mute}>({abs})</span>
    </time>
  );
}

function Commit({ repository, sha }: { repository: string; sha: string | null }) {
  const url = commitUrl(repository, sha);
  if (!sha) return <span className={styles.mute}>not available</span>;
  return url ? (
    <a className={styles.sha} href={url} target="_blank" rel="noreferrer" >
      {shortSha(sha)}
      <NewTab />
    </a>
  ) : (
    <span className={styles.sha}>{shortSha(sha)}</span>
  );
}

function sourceVerdict(source: UpstreamSourceStatus): { tone: StatusTone; text: string } {
  if (source.status !== "ok") return { tone: "neutral", text: "Not checked, GitHub did not answer" };
  if (isSourceUnknown(source)) return { tone: "neutral", text: "Comparison unavailable" };
  if (isSourceBehind(source)) {
    const parts: string[] = [];
    if (source.behindCommits != null) parts.push(`${source.behindCommits} ${source.behindCommits === 1 ? "commit" : "commits"}`);
    if (source.behindDays != null) parts.push(`${source.behindDays} ${source.behindDays === 1 ? "day" : "days"}`);
    const base = source.comparison === "diverged" ? "Diverged from upstream" : "Behind";
    return { tone: "warn", text: parts.length ? `${base} by ${parts.join(", ")}` : base };
  }
  if (source.comparison === "behind") return { tone: "neutral", text: "Pin is newer than upstream HEAD" };
  if (source.comparison === "identical") return { tone: "ready", text: "Same as upstream HEAD" };
  return { tone: "neutral", text: "Comparison unavailable" };
}

export function EngineSection({ status, now }: { status: CardDataStatus; now: number }) {
  const { engine, upstream } = status;
  const newCdbs = newUpstreamCdbFiles(status);
  const preparedNote =
    engine.preparedAtSource === "manifest-mtime" ? "estimate, from the bundle file date"
    : engine.preparedAtSource === "unknown" ? "unknown, old bundle" : null;
  return (
    <section className="set-sec" aria-labelledby="cd-engine">
      <div className="set-intro">
        <h2 id="cd-engine">Engine data</h2>
        <p>The Project Ignis files the duel engine runs on, compared with upstream HEAD.</p>
      </div>
      <div className={styles.block}>
        <FloorList aria-label="Pinned Project Ignis sources">
          {SOURCE_ORDER.map((key: EngineDataSource) => {
            const pin = engine.sources[key];
            const up = upstream.sources[key];
            const verdict = sourceVerdict(up);
            return (
              <FloorRow key={key} className={styles.sourceRow} aria-label={SOURCE_LABEL[key]}>
                <div className={styles.sourceMain}>
                  <p className={styles.rowTitle}>{SOURCE_LABEL[key]}</p>
                  <p className={styles.rowNote}>
                    Pinned <Commit repository={pin.repository} sha={pin.pinnedSha} />
                    {pin.pinnedCommitDate ? <> · {absoluteDate(pin.pinnedCommitDate)}</> : null}
                  </p>
                </div>
                <div className={styles.sourceState} data-tone={verdict.tone}>
                  <p className={styles.verdict}>{verdict.text}</p>
                  {up.status === "ok" && up.latestSha ? (
                    <p className={styles.rowNote}>
                      Upstream <Commit repository={up.repository} sha={up.latestSha} />
                      {up.latestCommitDate ? <> · {absoluteDate(up.latestCommitDate)}</> : null}
                    </p>
                  ) : null}
                </div>
              </FloorRow>
            );
          })}
        </FloorList>

        <dl className={styles.facts}>
          <div><dt>Bundle version</dt><dd className={styles.mono}>{engine.bundleVersion || "unknown"}</dd></div>
          <div><dt>Engine cards</dt><dd>{engine.cardCount.toLocaleString("en-US")}</dd></div>
          <div>
            <dt>Prepared</dt>
            <dd>
              <When iso={engine.preparedAt} now={now} />
              {preparedNote ? <span className={styles.flag}>{preparedNote}</span> : null}
            </dd>
          </div>
        </dl>

        <div>
          <p className={styles.label}>Loaded .cdb files</p>
          {engine.cdbFiles.length ? (
            <ul className={styles.chips} aria-label="Loaded cdb files">
              {engine.cdbFiles.map((file) => <li key={file} className={styles.chip}>{file}</li>)}
            </ul>
          ) : (
            <p className={styles.rowNote}>The bundle lists no .cdb files.</p>
          )}
          {upstream.babelCdbFiles.status !== "ok" ? (
            <p className={styles.rowNote}>Upstream release files could not be checked.</p>
          ) : newCdbs.length ? (
            <div className={styles.newFiles}>
              <StatusLine tone="warn">
                <b>{newCdbs.length} new {newCdbs.length === 1 ? "file" : "files"} upstream, not loaded:</b>{" "}
                {newCdbs.join(", ")}
              </StatusLine>
            </div>
          ) : (
            <p className={styles.rowNote}>No new release files upstream.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function CatalogSection({ status, now }: { status: CardDataStatus; now: number }) {
  const { catalog } = status;
  return (
    <section className="set-sec" aria-labelledby="cd-catalog">
      <div className="set-intro">
        <h2 id="cd-catalog">Card catalog</h2>
        <p>Card data cached from YGOPRODeck. It fills on demand, so the count is cards seen so far.</p>
      </div>
      <div className={styles.block}>
        <dl className={styles.facts}>
          <div>
            <dt>Last successful sync</dt>
            <dd>{catalog.lastSuccessfulSyncAt ? <When iso={catalog.lastSuccessfulSyncAt} now={now} /> : <span className={styles.mute}>never</span>}</dd>
          </div>
          <div><dt>Cards cached</dt><dd>{catalog.totalCards.toLocaleString("en-US")}</dd></div>
          <div>
            <dt>Last card cached</dt>
            <dd>{catalog.lastCardCachedAt ? <When iso={catalog.lastCardCachedAt} now={now} /> : <span className={styles.mute}>never</span>}</dd>
          </div>
        </dl>
        <div>
          <p className={styles.label}>Newest sets</p>
          {catalog.newestSets.length ? (
            <FloorList aria-label="Newest sets">
              {catalog.newestSets.map((set) => (
                <FloorRow key={`${set.code ?? ""}-${set.name}`}>
                  <span className="sv-cell-grow">{set.name}</span>
                  <span className={styles.mono}>{set.code ?? ""}</span>
                  <span className="sv-cell-mute">{absoluteDate(set.releaseDate) ?? "no date"}</span>
                </FloorRow>
              ))}
            </FloorList>
          ) : (
            <p className={styles.rowNote}>No sets cached yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function GapSection({ status }: { status: CardDataStatus }) {
  const { gap } = status;
  const [input, setInput] = React.useState("");
  // The count line is a live region, so the filter waits for a pause in typing.
  const [query, setQuery] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(input);
      setShown(GAP_PAGE);
    }, FILTER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [input]);
  const [shown, setShown] = React.useState(GAP_PAGE);
  const sorted = React.useMemo(() => sortGap(gap.catalogMissingFromEngine), [gap.catalogMissingFromEngine]);
  const filtered = React.useMemo(() => filterGap(sorted, query), [sorted, query]);
  const visible = filtered.slice(0, shown);
  const truncatedByServer = gap.catalogMissingFromEngineCount > gap.catalogMissingFromEngine.length;
  return (
    <section className="set-sec" aria-labelledby="cd-gap">
      <div className="set-intro">
        <h2 id="cd-gap">Gap</h2>
        <p>Catalog cards the duel engine does not know yet, newest set first.</p>
      </div>
      <div className={styles.block}>
        <dl className={styles.facts}>
          <div>
            <dt>In catalog, not in engine</dt>
            <dd data-bad={gap.catalogMissingFromEngineCount > 0 ? "true" : undefined}>
              {gap.catalogMissingFromEngineCount.toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt>In engine, not in catalog</dt>
            <dd>{gap.engineMissingFromCatalogCount.toLocaleString("en-US")}</dd>
          </div>
        </dl>
        {gap.catalogMissingFromEngine.length === 0 ? (
          <p className={styles.rowNote}>
            {gap.catalogMissingFromEngineCount === 0 ? "No gap. The engine knows every cached catalog card." : "The server sent no card list."}
          </p>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="cd-gap-search">Filter by name, passcode or set code</label>
              <input
                id="cd-gap-search"
                className="input"
                type="search"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="e.g. Blue-Eyes or RA05"
              />
            </div>
            <p className={styles.rowNote} role="status">
              {query.trim()
                ? `${filtered.length} of ${gap.catalogMissingFromEngine.length} listed cards match`
                : `Showing ${Math.min(visible.length, filtered.length)} of ${gap.catalogMissingFromEngine.length}`}
              {truncatedByServer ? `. The server listed ${gap.catalogMissingFromEngine.length} of ${gap.catalogMissingFromEngineCount}.` : ""}
            </p>
            <div className={styles.gapScroll} tabIndex={0} role="region" aria-label="Cards missing from the engine">
              <table className={styles.gapTable}>
                <thead>
                  <tr><th scope="col" className={styles.thumbCol}><span className="sv-sr">Art</span></th><th scope="col">Name</th><th scope="col">Passcode</th><th scope="col">Set</th><th scope="col">Released</th></tr>
                </thead>
                <tbody>
                  {visible.map((card) => (
                    <tr key={card.id}>
                      <td className={styles.thumbCol}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className={styles.thumb} src={cardImageUrl(card.id, "small")} alt="" loading="lazy" width={32} height={46} />
                      </td>
                      <td className={styles.gapName}>{card.name}</td>
                      <td className={styles.mono}>{card.id}</td>
                      <td className={styles.mono}>{card.setCode ?? "none"}</td>
                      <td>{absoluteDate(card.setReleaseDate) ?? "none"}</td>
                    </tr>
                  ))}
                  {visible.length === 0 ? <tr><td colSpan={5} className={styles.mute}>No card matches this filter.</td></tr> : null}
                </tbody>
              </table>
            </div>
            {filtered.length > visible.length ? (
              <SvButton variant="ghost" onClick={() => setShown((n) => n + GAP_PAGE)}>
                Show more ({filtered.length - visible.length} left)
              </SvButton>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

export function WorkflowSection({ status, now }: { status: CardDataStatus; now: number }) {
  const { updateWorkflow: wf } = status;
  const run = wf.lastRun;
  const runTone: StatusTone = !run ? "neutral" : run.conclusion === "success" ? "ready" : run.status !== "completed" ? "neutral" : "warn";
  const runWord = !run ? null : run.status !== "completed" ? `Running (${run.status})` : run.conclusion === "success" ? "Succeeded" : `Finished: ${run.conclusion ?? "no result"}`;
  return (
    <section className="set-sec" aria-labelledby="cd-workflow">
      <div className="set-intro">
        <h2 id="cd-workflow">Weekly engine data update</h2>
        <p>The scheduled workflow that opens a pull request with newer Project Ignis data.</p>
      </div>
      <div className={styles.block}>
        <div>
          <p className={styles.label}>Last run</p>
          {wf.lastRunStatus !== "ok" ? (
            <StatusLine tone="neutral">Could not read the last run from GitHub.</StatusLine>
          ) : run ? (
            <StatusLine tone={runTone}>
              <b>{runWord}</b>, <When iso={run.date} now={now} />{" "}
              <a href={run.url} target="_blank" rel="noreferrer">View run<NewTab /></a>
            </StatusLine>
          ) : (
            <p className={styles.rowNote}>No run found.</p>
          )}
        </div>
        <div>
          <p className={styles.label}>Open update pull request</p>
          {wf.pullRequestStatus !== "ok" ? (
            <StatusLine tone="neutral">Could not look up pull requests on GitHub.</StatusLine>
          ) : wf.openPullRequest ? (
            <StatusLine tone="ready">
              <a href={wf.openPullRequest.url} target="_blank" rel="noreferrer">#{wf.openPullRequest.number} {wf.openPullRequest.title}<NewTab /></a>,
              updated <When iso={wf.openPullRequest.updatedAt} now={now} />
            </StatusLine>
          ) : (
            <p className={styles.rowNote}>No open update pull request.</p>
          )}
        </div>
      </div>
    </section>
  );
}

