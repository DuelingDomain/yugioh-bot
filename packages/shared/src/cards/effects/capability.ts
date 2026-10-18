/** Runtime switch; API responses carry this capability to clients. */
export function effectSearchEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.EFFECT_SEARCH !== undefined) return env.EFFECT_SEARCH === "1";
  return env.NODE_ENV !== "production";
}

export const EFFECT_SEARCH_ATTRIBUTION = "Effect search powered by searchygo";

/** Fast gate shared by the browser pool search and host; ordinary card names need no phrase reader. */
export function mayReadEffect(text: string): boolean {
  return /\b(?:between|before|after|since|released|era|newest|new cards|last|in|from|pre|older|atk|attack|\d{4}\s*(?:[-–]|to)\s*\d{4}|negat\w*|search\w*|summon\w*|draw\w*|banish\w*|destroy\w*|reviv\w*|mill\w*|discard\w*|tribut\w*|return\w*|bounce\w*|support\w*|synerg\w*|floodgate\w*|extend\w*|removal|hand ?traps?|board ?breakers?|tuners?|level|rank|piercing|unaffected|recursion|protection|tokens?|gain|prevent|control|change|hate|anti|disruption|burn|stall|battle|floater\w*|recruiter\w*|tutor\w*|activat\w*|triggers?|works?|spellcasters?|dragons?|water|dark|light)\b/i.test(text);
}
