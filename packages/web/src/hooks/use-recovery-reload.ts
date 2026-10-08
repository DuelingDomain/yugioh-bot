"use client";

import { useEffect } from "react";
import type { AuthFlowState } from "../lib/auth-flow";

export const useRecoveryReload = (step: AuthFlowState["step"]) => {
  useEffect(() => {
    if (step !== "recovering") return;
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [step]);
};
