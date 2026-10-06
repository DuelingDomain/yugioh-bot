"use client";

import { useEffect, useState } from "react";

let cached: boolean | null = null;
let pending: Promise<boolean> | null = null;

/** One request per page load. Any failure counts as "not an admin": the link just stays hidden. */
function loadAccess(): Promise<boolean> {
  pending ??= (async () => {
    try {
      const res = await fetch("/api/sandbox/access", { cache: "no-store" });
      const body = res.ok ? ((await res.json()) as { admin?: unknown } | null) : null;
      return body?.admin === true;
    } catch {
      return false;
    }
  })().then((admin) => {
    cached = admin;
    return admin;
  });
  return pending;
}

/** True when the signed-in person is a guild admin, so the Sandbox link may show. False until it is known. */
export function useSandboxAccess(): boolean {
  const [admin, setAdmin] = useState(cached === true);
  useEffect(() => {
    let live = true;
    void loadAccess().then((value) => {
      if (live) setAdmin(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return admin;
}

/** Test hook: forget the cached answer. */
export function resetSandboxAccessCache(): void {
  cached = null;
  pending = null;
}
