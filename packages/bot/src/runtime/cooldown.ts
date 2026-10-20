export class Cooldown {
  private actors = new Map<string, number>();
  private busy = new Set<string>();
  async run(guildId: string, actorId: string, operation: () => Promise<void>): Promise<boolean> {
    const now = Date.now();
    for (const [id, until] of this.actors) if (until <= now) this.actors.delete(id);
    const key = `${guildId}:${actorId}`;
    if (this.busy.has(guildId) || (this.actors.get(key) ?? 0) > now) return false;
    this.actors.set(key, now + 3000);
    this.busy.add(guildId);
    try { await operation(); } finally { this.busy.delete(guildId); }
    return true;
  }
}
