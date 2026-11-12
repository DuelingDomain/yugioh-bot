/**
 * Allowlist for test recording of Remote Duels, read at request time. REMOTE_RECORD_USERS is a comma list of application
 * users.id values (the same ids as REMOTE_DUELS_USERS). Unset or empty means the feature is off for everybody. There is no `*`.
 */
export function isRemoteRecordUser(userId: number): boolean {
  if (!Number.isSafeInteger(userId) || userId <= 0) return false;
  return (process.env.REMOTE_RECORD_USERS ?? "").split(",").some(part => part.trim() === String(userId));
}
