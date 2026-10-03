// What the login page says for each ?error= value. Auth.js 5 sends the names below; the two
// GuildMembership names come from this app's own redirect in src/lib/auth.ts.

export type LoginMessage = {
  tone: "info" | "bad";
  title: string;
  body: string;
  /** Shown as "Error: <code>" so someone running the bot can match it to a log. */
  code?: string;
};

export function describeLoginError(error: string | undefined): LoginMessage | null {
  if (!error) return null;
  switch (error) {
    case "OAuthCallbackError":
      return {
        tone: "info",
        title: "Sign-in didn't finish.",
        body: "If you pressed Cancel on Discord, that's all this is. Try again when you're ready.",
      };
    case "Configuration":
      return {
        tone: "bad",
        title: "Couldn't sign you in.",
        body: "The problem is on Duelists Kingdom's side, not your Discord account. Try again in a minute. If it keeps happening, tell whoever runs the bot.",
        code: "Configuration",
      };
    case "GuildMembershipRequired":
      return {
        tone: "bad",
        title: "You're not in the Discord server.",
        body: "You must be a member of the Discord server to use this app. Join it, then sign in again.",
      };
    case "GuildMembershipUnavailable":
      return {
        tone: "bad",
        title: "Couldn't check your Discord server membership.",
        body: "Try again in a minute. If it keeps happening, tell whoever runs the bot.",
      };
    default:
      return {
        tone: "bad",
        title: "Sign-in didn't work.",
        body: "Try again. If it keeps happening, tell whoever runs the bot.",
        code: error,
      };
  }
}
