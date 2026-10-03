export function connectionLabel(terminal: boolean, connection?: {
  syncing?: boolean; stale?: boolean; error?: unknown; recovering?: boolean; connected?: boolean;
}): string {
  return terminal ? "Finished" : connection?.syncing || connection?.stale ? "Catching up…"
    : connection?.error || connection?.recovering ? "Reconnecting"
      : connection && !connection.connected ? "Polling" : "Live";
}
