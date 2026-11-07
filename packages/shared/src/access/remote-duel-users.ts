/**
 * Per-user rollout list for Remote Duels, read at authorization time. REMOTE_DUELS_USERS is a comma list of
 * application users.id values, or `*` for everybody. Unset means everybody, so local setups do not change;
 * empty means nobody. Production must set it. REMOTE_DUELS still closes everything on its own.
 */
export function isRemoteDuelUser(userId: number): boolean {
  const list = process.env.REMOTE_DUELS_USERS;
  if (list === undefined) return true;
  const parts = list.split(",").map(part => part.trim());
  return parts.includes("*") || (Number.isSafeInteger(userId) && userId > 0 && parts.includes(String(userId)));
}
