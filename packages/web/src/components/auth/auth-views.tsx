"use client";

import type { useSignInFlow } from "@/hooks/use-sign-in-flow";
import type { useSignUpFlow } from "@/hooks/use-sign-up-flow";
import type { AuthFlowState } from "@/lib/auth-flow";
import { AuthFlowShell } from "./flow-shell";
import { hardNavigate } from "./navigate";
import { signInHref, waitlistHref } from "./marketing-links";
import { AccountUnavailableStep } from "./steps/account-unavailable-step";
import { CheckingInviteStep } from "./steps/checking-invite-step";
import { CodeStep } from "./steps/code-step";
import { CreateAccountStep } from "./steps/create-account-step";
import { IdentifierStep } from "./steps/identifier-step";
import { NewPasswordStep } from "./steps/new-password-step";
import { NotInvitedStep } from "./steps/not-invited-step";
import { PasswordStep } from "./steps/password-step";
import { SignupClosedStep } from "./steps/signup-closed-step";
import { SigningStep } from "./steps/signing-step";
import { SuccessStep } from "./steps/success-step";

type SignInFlow = ReturnType<typeof useSignInFlow>;
type SignUpFlow = ReturnType<typeof useSignUpFlow>;

interface ViewProps<F> {
  flow: F;
  marketingUrl: string | null;
}

/** Every sign-in step. Pure in the flow it is given, so tests and the preview page can feed it static state. */
export function SignInView({ flow: { state, actions }, marketingUrl }: ViewProps<SignInFlow>) {
  const { pending, banner, fieldErrors } = state;
  const restart = () => hardNavigate(signInHref(state.returnTo));
  return (
    <AuthFlowShell state={state} marketingUrl={marketingUrl}>
      {(() => {
        switch (state.step) {
          case "password":
            return <PasswordStep identifier={state.identifier ?? ""} error={fieldErrors.password} banner={banner} pending={pending} onSubmit={actions.submitPassword} onForgot={actions.forgotPassword} onBack={actions.back} />;
          case "code":
            return <CodeStep purpose={state.codePurpose ?? "client-trust"} identifier={state.identifier} error={fieldErrors.code} banner={banner} pending={pending} resendAvailableAt={state.resendAvailableAt} onSubmit={actions.submitCode} onResend={actions.resendCode} onBack={actions.back} />;
          case "newpw":
            return <NewPasswordStep identifier={state.identifier} errors={{ newPassword: fieldErrors.newPassword, confirm: fieldErrors.confirm }} banner={banner} pending={pending} onSubmit={actions.submitNewPassword} />;
          case "signing":
            return <SigningStep banner={banner} onRetry={restart} />;
          case "success":
            return <SuccessStep />;
          case "err-invite":
            return <NotInvitedStep identifier={state.identifier ?? ""} waitlistUrl={waitlistHref(marketingUrl)} onRetry={actions.back} />;
          case "err-signup":
            return <SignupClosedStep waitlistUrl={waitlistHref(marketingUrl)} onRetry={restart} />;
          case "err-banned":
            return <AccountUnavailableStep onBack={restart} />;
          default:
            return <IdentifierStep identifier={state.identifier ?? undefined} error={fieldErrors.identifier} banner={banner} pending={pending} onSubmit={actions.submitIdentifier} onDiscord={actions.continueWithDiscord} marketingUrl={marketingUrl ?? undefined} />;
        }
      })()}
    </AuthFlowShell>
  );
}

interface AccountViewProps extends ViewProps<{ state: AuthFlowState; actions: SignUpFlow["actions"] }> {
  /**
   * The SSO callback card: Discord is already chosen, so only username and consent are asked (no password, no second
   * Discord button), and the page opens on "Signing you in".
   */
  callback?: boolean;
}

/** Every sign-up step, shared by `/sign-up` and `/sso-callback`. Both own the single `#clerk-captcha` from first paint. */
export function AccountView({ flow: { state, actions }, marketingUrl, callback = false }: AccountViewProps) {
  const { pending, banner, fieldErrors } = state;
  const restart = () => hardNavigate(signInHref(state.returnTo));
  const reload = () => hardNavigate(window.location.href);
  return (
    <AuthFlowShell state={state} marketingUrl={marketingUrl} captcha>
      {(() => {
        switch (state.step) {
          case "invite":
            // Retrying reloads this URL, so the invitation ticket is consumed again from a clean Clerk attempt.
            if (!state.lockedEmail) return <CheckingInviteStep banner={banner} onRetry={reload} />;
            return <CreateAccountStep lockedEmail={state.lockedEmail} errors={{ username: fieldErrors.username, password: fieldErrors.password, legal: fieldErrors.legal }} banner={banner} pending={pending} onSubmit={actions.submitAccount} onDiscord={actions.continueWithDiscord} passwordOptional={callback} />;
          case "code":
            // The invitation email is locked, so there is no way back to a different one.
            return <CodeStep purpose={state.codePurpose ?? "signup"} identifier={state.lockedEmail ?? state.identifier} error={fieldErrors.code} banner={banner} pending={pending} resendAvailableAt={state.resendAvailableAt} onSubmit={actions.submitCode} onResend={actions.resendCode} />;
          case "signing":
            return <SigningStep banner={banner} onRetry={restart} />;
          case "success":
            return <SuccessStep />;
          case "err-banned":
            return <AccountUnavailableStep onBack={restart} />;
          default:
            return <SignupClosedStep waitlistUrl={waitlistHref(marketingUrl)} onRetry={restart} />;
        }
      })()}
    </AuthFlowShell>
  );
}
