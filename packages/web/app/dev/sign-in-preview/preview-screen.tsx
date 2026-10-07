"use client";

import { AccountUnavailableStep } from "@/components/auth/steps/account-unavailable-step";
import { CodeStep } from "@/components/auth/steps/code-step";
import { CreateAccountStep } from "@/components/auth/steps/create-account-step";
import { IdentifierStep } from "@/components/auth/steps/identifier-step";
import { NewPasswordStep } from "@/components/auth/steps/new-password-step";
import { NotInvitedStep } from "@/components/auth/steps/not-invited-step";
import { PasswordStep } from "@/components/auth/steps/password-step";
import { SignupClosedStep } from "@/components/auth/steps/signup-closed-step";
import { SigningStep } from "@/components/auth/steps/signing-step";
import { SuccessStep } from "@/components/auth/steps/success-step";
import type { PreviewStep } from "./steps";

const EMAIL = "sam@example.com";
const WAITLIST = "https://duelingdomain.com/#join";
const noop = () => {};

/** One step card with static props and no-op handlers. Handlers cannot cross the server boundary, so this is a client file. */
export function PreviewScreen({ step, resendAvailableAt }: { step: PreviewStep; resendAvailableAt: number }) {
  switch (step) {
    case "signin":
      return <IdentifierStep pending={false} onSubmit={noop} onDiscord={noop} marketingUrl="https://duelingdomain.com" />;
    case "err-service":
      return (
        <IdentifierStep
          pending={false}
          banner={{ tone: "bad", body: "Sign-in is having trouble. Try again in a minute." }}
          onSubmit={noop}
          onDiscord={noop}
          marketingUrl="https://duelingdomain.com"
        />
      );
    case "password":
      return <PasswordStep identifier={EMAIL} pending={false} onSubmit={noop} onForgot={noop} onBack={noop} />;
    case "err-password":
      return <PasswordStep identifier={EMAIL} error="That password isn’t right. Check it and try again." pending={false} onSubmit={noop} onForgot={noop} onBack={noop} />;
    case "code":
      return <CodeStep purpose="reset" identifier={EMAIL} pending={false} resendAvailableAt={resendAvailableAt} defaultCode="4829" onSubmit={noop} onResend={noop} onBack={noop} />;
    case "newpw":
      return <NewPasswordStep identifier={EMAIL} errors={{}} pending={false} onSubmit={noop} />;
    case "invite":
      return <CreateAccountStep lockedEmail={EMAIL} errors={{}} pending={false} onSubmit={noop} onDiscord={noop} captchaPlaceholder />;
    case "invite-sso":
      return <CreateAccountStep lockedEmail={EMAIL} errors={{}} pending={false} onSubmit={noop} onDiscord={noop} passwordOptional captchaPlaceholder />;
    case "err-username":
      return (
        <CreateAccountStep
          lockedEmail={EMAIL}
          errors={{ username: "That username is taken. Try another." }}
          defaultUsername="cardshark"
          pending={false}
          onSubmit={noop}
          onDiscord={noop}
          captchaPlaceholder
        />
      );
    case "err-invite":
      return <NotInvitedStep identifier={EMAIL} waitlistUrl={WAITLIST} onRetry={noop} />;
    case "err-signup":
      return <SignupClosedStep waitlistUrl={WAITLIST} onRetry={noop} />;
    case "err-banned":
      return <AccountUnavailableStep onBack={noop} />;
    case "signing":
      return <SigningStep />;
    case "success":
      return <SuccessStep />;
  }
}
