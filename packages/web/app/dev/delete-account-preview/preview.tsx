"use client";

import * as React from "react";
import { DeleteAccountView, type DeleteAccountError } from "@/components/account/delete-account-section";
import type { PreviewState } from "./states";

const USERNAME = "yugi_moto";

/** The real view with fixed props per state. Every state but idle has the username typed; a 400 means the server disagreed with a client-side match (the username changed elsewhere). */
export function DeleteAccountPreview({ state }: { state: PreviewState }) {
  const [value, setValue] = React.useState(state === "idle" ? "" : USERNAME);
  const error: DeleteAccountError | null = state === "mismatch" || state === "retry" || state === "server" || state === "signed_out" ? state : null;
  return <DeleteAccountView username={USERNAME} value={value} onValueChange={setValue} pending={state === "pending"} error={error} onSubmit={() => {}} />;
}
