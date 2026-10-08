/** Every `data-screen` of docs/design/sign-in/reference/all-steps.dom.html, plus the SSO missing-requirements card. */
export const PREVIEW_STEPS = [
  "signin",
  "password",
  "code",
  "newpw",
  "invite",
  "invite-sso",
  "err-username",
  "err-invite",
  "err-signup",
  "err-password",
  "err-banned",
  "err-service",
  "signing",
  "recovering",
  "success",
] as const;

export type PreviewStep = (typeof PREVIEW_STEPS)[number];

export function isPreviewStep(value: unknown): value is PreviewStep {
  return typeof value === "string" && (PREVIEW_STEPS as readonly string[]).includes(value);
}
