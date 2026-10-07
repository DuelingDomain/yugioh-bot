/**
 * Types copied from Task 2's interface block (packages/web/src/lib/auth-flow.ts and auth-errors.ts).
 * TODO: when Task 2 merges, replace this file's contents with
 * `export type { AuthStep, CodePurpose, FieldName, AuthBanner, AuthFlowState, AuthEvent, AuthErrorView } from "@/lib/auth-flow";`
 * (and the AuthErrorView re-export from "@/lib/auth-errors").
 * Step components only need AuthBanner, CodePurpose, FieldName and AuthStep.
 */
export type AuthStep = "signin" | "password" | "code" | "newpw" | "invite" | "signing" | "success"
  | "err-invite" | "err-signup" | "err-banned";
export type CodePurpose = "signup" | "reset" | "client-trust";
export type FieldName = "identifier" | "password" | "code" | "newPassword" | "confirm" | "username" | "legal";
export interface AuthBanner { tone: "bad" | "info"; body: string; code?: string }

export type AuthErrorView =
  | { kind: "step"; step: "err-invite" | "err-signup" | "err-banned" }
  | { kind: "field"; field: FieldName; message: string }
  | { kind: "banner"; banner: AuthBanner };

export interface AuthFlowState {
  step: AuthStep;
  identifier: string | null;      // email shown on password/code/err-invite steps
  lockedEmail: string | null;     // invitation email from Clerk, never from the query string
  codePurpose: CodePurpose | null;
  fieldErrors: Partial<Record<FieldName, string>>;
  banner: AuthBanner | null;      // err-service and info notices on the current step
  pending: boolean;
  resendAvailableAt: number | null; // epoch ms; resend disabled until then (30 s)
  returnTo: string;
}
export type AuthEvent =
  | { type: "submit" } | { type: "settled" }
  | { type: "identified"; identifier: string } | { type: "needs-password" }
  | { type: "code-sent"; purpose: CodePurpose; now: number } | { type: "needs-new-password" }
  | { type: "invite-ready"; lockedEmail: string } | { type: "complete" } | { type: "finalized" }
  | { type: "error"; view: AuthErrorView } | { type: "back" };
