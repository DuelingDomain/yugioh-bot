"use client";

import { useEffect, type CSSProperties } from "react";
import type { DuelChainLink } from "@yugidraft/shared/duels";
import { cardArtUrl } from "../constants";
import { chainLinkLabel, type ResponseWindow } from "./tag-logic";
import styles from "./tag-stage.module.css";

export interface HubSeatTone {
  rgb: string;
  ink: string;
}

export interface HubPick {
  seats: readonly number[];
  onPick: (seat: number) => void;
  title: string;
}

export interface HelipadHubProps {
  chain: readonly DuelChainLink[];
  anchorSeat: number;
  nameOf: (seat: number) => string;
  toneOf: (seat: number) => HubSeatTone;
  response: ResponseWindow | null;
  /** "Starfall ◆" for a team index. */
  teamLabel: (team: number) => string;
  pick: HubPick | null;
  hubRef?: (node: HTMLDivElement | null) => void;
}

function seatVars(tone: HubSeatTone): CSSProperties {
  return { ["--seat" as string]: tone.rgb, ["--seat-ink" as string]: tone.ink } as CSSProperties;
}

const MEMBER_TEXT = { choosing: "choosing", waiting: "waiting", passed: "passed" } as const;

/** Chain rail, response-window line and the choose-a-rival bar. It floats on the helipad and the stage places it. */
export function HelipadHub({ chain, anchorSeat, nameOf, toneOf, response, teamLabel, pick, hubRef }: HelipadHubProps) {
  useEffect(() => {
    if (!pick) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < pick.seats.length) {
        event.preventDefault();
        pick.onPick(pick.seats[index]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick]);

  if (chain.length === 0 && !response && !pick) return null;
  return (
    <div ref={hubRef} className={styles.hub} data-hub>
      {chain.length > 0 ? (
        <div className={styles.crail} role="list" aria-label="Chain">
          <div className={styles.ch}>
            Chain
            <em>resolves last to first</em>
          </div>
          {chain.map((link, i) => {
            const tone = toneOf(link.seat);
            return (
              <div key={link.index} style={{ display: "contents" }}>
                {i > 0 ? <span className={styles.carr} aria-hidden="true">›</span> : null}
                <div className={styles.clink} role="listitem" data-chain-link={link.index} data-chain-seat={link.seat} style={seatVars(tone)}>
                  <span className={styles.lb}>{link.index}</span>
                  <span
                    className={styles.th}
                    data-card-art={link.code != null ? "" : undefined}
                    style={link.code != null ? { backgroundImage: `url(${cardArtUrl(link.code, "small")})` } : undefined}
                  />
                  <span className={styles.lt}>
                    <b>{link.name ?? "Card"}</b>
                    <span>{chainLinkLabel(link, anchorSeat, nameOf)}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {response ? (
        <div className={styles.resp} data-response-window role="status">
          <span className={styles.rt}>
            Response window <span className={styles.arr}>›</span> {teamLabel(response.team)}
          </span>
          {response.members.map((m) => (
            <span key={m.seat} className={styles.mm} data-k={m.state} style={seatVars(toneOf(m.seat))}>
              <span className={styles.seatname}>{nameOf(m.seat).split(" ")[0]}</span> {MEMBER_TEXT[m.state]}
            </span>
          ))}
          {response.otherPassed ? <span className={styles.mm} data-k="passed">{teamLabel(1 - response.team)} passed</span> : null}
        </div>
      ) : null}
      {pick ? (
        <div className={styles.bar} data-pick-bar role="group" aria-label={pick.title}>
          <span className={styles.bt}>{pick.title}</span>
          {pick.seats.map((seat, i) => (
            <button key={seat} type="button" className={styles.btn} data-seatpick="true" style={seatVars(toneOf(seat))} onClick={() => pick.onPick(seat)}>
              <kbd>{i + 1}</kbd>
              {nameOf(seat).split(" ")[0]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
