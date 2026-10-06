"use client";

import { useEffect, useState } from "react";

let cached: boolean | null = null;
let pending: Promise<boolean> | null = null;

/** One request per page load. Any failure counts as "not allowed": the link just stays hidden. */
function loadAccess(): Promise<boolean> {
  pending ??= (async () => {
    try {
      const res = await fetch("/api/sandbox/access", { cache: "no-store" });
      const body = res.ok ? ((await res.json()) as { allowed?: unknown } | null) : null;
      return body?.allowed === true;
    } catch {
      return false;
    }
  })().then((allowed) => {
    cached = allowed;
    return allowed;
  });
  return pending;
}

/** True when the signed-in person has sandbox access, so the Sandbox link may show. False until it is known. */
export function useSandboxAccess(): boolean {
  const [allowed, setAllowed] = useState(cached === true);
  useEffect(() => {
    let live = true;
    void loadAccess().then((value) => {
      if (live) setAllowed(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return allowed;
}

/** Test hook: forget the cached answer. */
export function resetSandboxAccessCache(): void {
  cached = null;
  pending = null;
}
