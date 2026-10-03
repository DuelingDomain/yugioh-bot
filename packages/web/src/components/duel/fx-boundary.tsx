"use client";

import { Component, type ErrorInfo, type ReactNode, type RefObject } from "react";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { maxEventId } from "./event-queue";
import { captureDepartureSnapshots, clearZoneSnapshots } from "./move-plan";

/** Captures old board geometry in React's pre-mutation commit phase, including batched updates. */
export class MoveSourceBoundary extends Component<{
  children: ReactNode;
  events: readonly DuelEvent[];
  duelKey: string;
  root: RefObject<HTMLElement | null>;
}> {
  getSnapshotBeforeUpdate(previous: Readonly<typeof this.props>): null {
    if (previous.duelKey !== this.props.duelKey) {
      clearZoneSnapshots();
      return null;
    }
    const cursor = maxEventId(previous.events) ?? 0;
    const fresh = this.props.events.filter((event) => event.id > cursor);
    if (fresh.length > 0 && this.props.root.current) captureDepartureSnapshots(fresh, this.props.root.current);
    return null;
  }

  componentDidUpdate(): void {}

  componentWillUnmount(): void {
    clearZoneSnapshots();
  }

  render(): ReactNode {
    return this.props.children;
  }
}

/** Reports an effects crash to the web server log (see /api/duels/client-error). */
export function reportDuelClientError(error: unknown, componentStack = ""): void {
  const err = error instanceof Error ? error : new Error(String(error));
  try {
    void fetch("/api/duels/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: window.location.href, message: `${err.name}: ${err.message}`, stack: err.stack ?? "", componentStack }),
    }).catch(() => undefined);
  } catch {
    // reporting must never throw
  }
}

const RETRY_MS = 1000;

/**
 * Keeps an effects layer from taking the duel room down: a crash in an animation drops the effects
 * for a moment, reports the error and mounts them fresh. The board itself never depends on them.
 */
export class FxBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private retry: number | undefined;

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportDuelClientError(error, info.componentStack ?? "");
    window.clearTimeout(this.retry);
    this.retry = window.setTimeout(() => this.setState({ failed: false }), RETRY_MS);
  }

  componentWillUnmount(): void {
    window.clearTimeout(this.retry);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
