/**
 * Owner-only pages (today: card data status). There is no admin role: the owner lists their own `users.id`
 * values in OWNER_USER_IDS (comma separated), read per request. Unset or empty means nobody.
 */
export function ownerUserIds(): Set<number> {
  const ids = new Set<number>();
  for (const part of (process.env.OWNER_USER_IDS ?? "").split(",")) {
    const value = part.trim();
    if (/^[1-9]\d*$/.test(value)) ids.add(Number(value));
  }
  return ids;
}

export function isOwnerUser(userId: number): boolean {
  return ownerUserIds().has(userId);
}
