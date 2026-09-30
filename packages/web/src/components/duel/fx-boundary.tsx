"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

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
