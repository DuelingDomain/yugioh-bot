"use client";

import { RotateCw } from "lucide-react";
import { useFormStatus } from "react-dom";
import { DiscordIcon } from "./login-marks";

/** Lives inside the sign-in form. While the action runs it holds, so a second press can't start a second sign-in. */
export function LoginButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary btn-lg" type="submit" disabled={pending} aria-busy={pending || undefined}>
      {pending ? <RotateCw className="ic spin" aria-hidden="true" /> : <DiscordIcon />}
      {pending ? "Opening Discord…" : "Sign in with Discord"}
    </button>
  );
}
