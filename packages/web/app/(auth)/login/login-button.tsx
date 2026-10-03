"use client";

import { RotateCw } from "lucide-react";
import { useFormStatus } from "react-dom";
import { svButtonClass } from "@/components/sheet";
import styles from "./login.module.css";
import { DiscordIcon } from "./login-marks";

/** Lives inside the sign-in form. While the action runs it holds, so a second press can't start a second sign-in. */
export function LoginButton() {
  const { pending } = useFormStatus();
  return (
    <button className={svButtonClass("primary", { big: true, wide: true })} type="submit" disabled={pending} aria-busy={pending || undefined}>
      {pending ? <RotateCw className={styles.spin} size={19} aria-hidden="true" /> : <DiscordIcon />}
      {pending ? "Opening Discord…" : "Sign in with Discord"}
    </button>
  );
}
