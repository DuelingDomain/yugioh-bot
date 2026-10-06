import { createElement, type ReactNode } from "react";

// What the login page says for each ?error= value. Auth.js 5 sends the names below; the two
// GuildMembership names come from this app's own redirect in src/lib/auth.ts.

export type LoginMessage = {
  tone: "info" | "bad";
  title: ReactNode;
  body: string;
  waitlistNote?: string;
  /** Shown as "Error: <code>" to match the service log. */
  code?: string;
  presentation?: "panel";
};

export function describeLoginError(error: string | undefined): LoginMessage | null {
  if (!error) return null;
  switch (error) {
    case "OAuthCallbackError":
      return {
        tone: "info",
        title: "Sign-in didn’t finish.",
        body: "If you pressed Cancel on Discord, that’s all this is. Try again when you’re ready.",
      };
    case "Configuration":
      return {
        tone: "bad",
        title: "Couldn’t sign you in.",
        body: "The problem is on our side, not your Discord account. Try again in a minute.",
        code: "Configuration",
      };
    case "GuildMembershipRequired":
      return {
        tone: "bad",
        title: ["Not in the ", createElement("em", { key: "alpha" }, "alpha"), " yet"],
        body: "Access opens in waves, and this Discord account isn’t in one yet.",
        waitlistNote: "Join the waitlist and we’ll email you when it’s your turn.",
        presentation: "panel",
      };
    case "GuildMembershipUnavailable":
      return {
        tone: "bad",
        title: "Couldn’t check your access just now.",
        body: "Try again in a minute.",
      };
    default:
      return {
        tone: "bad",
        title: "Sign-in didn’t work.",
        body: "Try again when you’re ready.",
        code: error,
      };
  }
}
