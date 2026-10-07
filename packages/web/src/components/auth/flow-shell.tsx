import type { ReactNode } from "react";
import type { AuthFlowState } from "@/lib/auth-flow";
import { CaptchaMount } from "./fields";
import { SignInShell } from "./sign-in-shell";

interface AuthFlowShellProps {
  state: Pick<AuthFlowState, "step" | "banner" | "fieldErrors">;
  marketingUrl: string | null;
  /**
   * Sign-up and the SSO callback call `signUp.ticket()` or hit a sign-up transfer as soon as they mount, and Clerk's bot
   * check needs `#clerk-captcha` in the DOM then. The page owns that node here, in every step, so no step renders one.
   */
  captcha?: boolean;
  children: ReactNode;
}

/** Error cards, a bad banner or a field error all turn the page tone bad, as the err-service and err-password mock shots do. */
function failing({ step, banner, fieldErrors }: Pick<AuthFlowState, "step" | "banner" | "fieldErrors">): boolean {
  return step.startsWith("err-") || banner?.tone === "bad" || Object.keys(fieldErrors).length > 0;
}

/** The sign-in shell with its two state-driven attributes: the pack opens on success, error cards turn the tone bad. */
export function AuthFlowShell({ state, marketingUrl, captcha = false, children }: AuthFlowShellProps) {
  return (
    <SignInShell
      marketingUrl={marketingUrl ?? undefined}
      packState={state.step === "success" ? "open" : "sealed"}
      tone={failing(state) ? "bad" : "neutral"}
    >
      {children}
      {captcha && <CaptchaMount />}
    </SignInShell>
  );
}
