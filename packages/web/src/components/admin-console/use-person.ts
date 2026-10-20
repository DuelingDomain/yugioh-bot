"use client";

import { useEffect, useState } from "react";
import type { PersonDetail, SectionResult, UserKey } from "@/lib/admin-console/types";

const POLL_MS = 20_000;

/** One person for the detail panel. Refreshes every 20 s while it is shown and the tab is visible. */
export function usePerson(userId: UserKey | null): { person: PersonDetail | null; failed: boolean; loading: boolean } {
  const [state, setState] = useState<{ id: number | null; person: PersonDetail | null; failed: boolean }>({ id: null, person: null, failed: false });
  useEffect(() => {
    if (userId === null) return;
    let stop = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/admin/console/people/${userId}`, { cache: "no-store" });
        const body = res.ok ? await res.json() as SectionResult<PersonDetail> : null;
        if (stop) return;
        if (body?.state === "ok") setState({ id: userId, person: body.data, failed: false });
        else setState((prev) => ({ id: userId, person: prev.id === userId ? prev.person : null, failed: true }));
      } catch {
        if (!stop) setState((prev) => ({ id: userId, person: prev.id === userId ? prev.person : null, failed: true }));
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => { stop = true; clearInterval(timer); };
  }, [userId]);
  const current = state.id === userId;
  return { person: current ? state.person : null, failed: current && state.failed, loading: userId !== null && !current };
}
