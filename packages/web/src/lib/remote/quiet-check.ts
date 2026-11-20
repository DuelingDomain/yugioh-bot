import type { FieldTrack, FieldZone } from '@yugidraft/vision';
import type { TwinCard } from '@yugidraft/shared/remote';

/**
 * Quiet background check (off by default). It extends Scan field and the auto scan; it is not a second scanner.
 * It reads only what the field watcher already published (tracks, per-zone pixel activity, missing twins), so one check is a few
 * microseconds and adds no detector pass. A zone is looked at again only when its pixels moved after the last time the board and the camera
 * agreed there (the "ledger"). A gap that stays for two checks with no new motion is "sure": the caller runs one gentle scan and the normal
 * fix rules apply. A gap seen once, or one a scan could not fix, only becomes a hint on the Scan field button.
 */
export const QUIET_CHECK_STORAGE_KEY = 'dd-quiet-check';
export const quietCheckEnabled = () => {
  if (process.env.NEXT_PUBLIC_REMOTE_QUIET_CHECK === '1') return true;
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(QUIET_CHECK_STORAGE_KEY) === '1'; } catch { return false; }
};

export type QuietGapKind = 'face' | 'zone' | 'extra' | 'missing';
export interface QuietGap { zone: FieldZone; kind: QuietGapKind; ref?: string }
export interface QuietInput {
  now: number;
  tracks: readonly FieldTrack[];
  twins: readonly TwinCard[];
  /** Watcher clock: latest pixel motion per zone, and the time of the latest full detector pass. */
  activityAt: Partial<Record<FieldZone, number>>;
  lastFullAt?: number;
  missing: readonly string[];
  refOf: (trackId: string) => string;
  /** The zone the board believes a field card is in. */
  zoneOf: (card: TwinCard) => FieldZone | undefined;
  /** A card the player holds, moved by hand or brought back with Undo: never checked. */
  held: (ref: string) => boolean;
  /** An owner read or job is queued, the CPU is busy, the tab is hidden, a prompt is open, a scan runs. The check yields and keeps its state. */
  busy: boolean;
}
export interface QuietResult {
  verdict: 'wait' | 'idle' | 'fix' | 'hint';
  /** Zones inspected this time (dirty since their last confirmed read) and zones skipped as clean. */
  inspected: FieldZone[]; skipped: number;
  gaps: QuietGap[];
  reason?: string;
}
export interface QuietOptions { minGapMs?: number; settleMs?: number; sureChecks?: number }
const FIELD = (zone: string) => ['monster', 'spell-trap', 'field', 'pendulum', 'extra-monster'].includes(zone);
const gapKey = (g: QuietGap) => `${g.zone}:${g.kind}:${g.ref ?? ''}`;
const plural = (n: number) => `${n} card${n === 1 ? '' : 's'}`;
const WORDS: Record<QuietGapKind, string> = { face: 'face-up/face-down differs', zone: 'in another zone', extra: 'not on the board', missing: 'not seen by the camera' };

export function createQuietCheck({ minGapMs = 2000, settleMs = 1500, sureChecks = 2 }: QuietOptions = {}) {
  const confirmed = new Map<FieldZone, number>();
  const seen = new Map<string, { checks: number; activity: number }>();
  /** Gaps one gentle scan already tried: not scanned again until the zone moves, only hinted. */
  const tried = new Map<string, number>();
  let last = -Infinity;
  return {
    check(input: QuietInput): QuietResult {
      const { now } = input;
      const idle = (verdict: QuietResult['verdict'], inspected: FieldZone[] = [], skipped = 0, gaps: QuietGap[] = [], reason?: string): QuietResult => ({ verdict, inspected, skipped, gaps, ...(reason ? { reason } : {}) });
      // An owner read comes first: yield without touching any state, so the check never delays or aborts a read.
      if (input.busy) return idle('wait');
      if (now - last < minGapMs) return idle('wait');
      if (input.lastFullAt === undefined || now - input.lastFullAt > 3000) return idle('wait');
      last = now;
      const zones = new Set<FieldZone>();
      for (const t of input.tracks) if (t.visible && !t.removed) zones.add(t.zone);
      for (const c of input.twins) { const z = FIELD(c.zone) ? input.zoneOf(c) : undefined; if (z) zones.add(z); }
      const gaps: QuietGap[] = [], inspected: FieldZone[] = [];
      let skipped = 0;
      for (const zone of zones) {
        const moved = input.activityAt[zone] ?? -Infinity, since = confirmed.get(zone);
        // Clean: no pixel motion since the board and the camera last agreed here.
        if (since !== undefined && moved <= since) { skipped++; continue; }
        // Still moving: the normal tracker owns it.
        if (now - moved < settleMs) continue;
        inspected.push(zone);
        const here: QuietGap[] = [];
        for (const t of input.tracks) {
          if (t.zone !== zone || t.removed || !t.visible || t.state !== 'identified' || input.lastFullAt - t.firstSeen < settleMs) continue;
          const ref = input.refOf(t.id), card = input.twins.find(c => c.ref === ref);
          if (input.held(ref)) continue;
          if (!card || !FIELD(card.zone)) here.push({ zone, kind: 'extra', ref });
          else if (input.zoneOf(card) !== zone) here.push({ zone, kind: 'zone', ref });
          else if (card.faceUp === t.faceDown) here.push({ zone, kind: 'face', ref });
        }
        for (const ref of input.missing) {
          const card = input.twins.find(c => c.ref === ref);
          if (card && FIELD(card.zone) && input.zoneOf(card) === zone && !input.held(ref)) here.push({ zone, kind: 'missing', ref });
        }
        if (!here.length) { confirmed.set(zone, now); for (const key of [...seen.keys()]) if (key.startsWith(`${zone}:`)) { seen.delete(key); tried.delete(key); } continue; }
        gaps.push(...here);
      }
      // Forget gaps that closed on their own.
      const open = new Set(gaps.map(gapKey));
      for (const key of [...seen.keys()]) if (!open.has(key)) { seen.delete(key); tried.delete(key); }
      let sure = false, unsure = false;
      for (const gap of gaps) {
        const key = gapKey(gap), activity = input.activityAt[gap.zone] ?? -Infinity, before = seen.get(key);
        const entry = before && before.activity === activity ? { checks: before.checks + 1, activity } : { checks: 1, activity };
        seen.set(key, entry);
        if (tried.get(key) === activity) unsure = true;
        else if (entry.checks >= sureChecks) sure = true;
        else unsure = true;
      }
      if (sure) {
        // One gentle scan per gap and per zone motion. The caller reports back with `scanned()`.
        for (const gap of gaps) { const key = gapKey(gap); if ((seen.get(key)?.checks ?? 0) >= sureChecks && tried.get(key) !== (input.activityAt[gap.zone] ?? -Infinity)) tried.set(key, input.activityAt[gap.zone] ?? -Infinity); }
        return idle('fix', inspected, skipped, gaps);
      }
      if (unsure) {
        const kinds = [...new Set(gaps.map(g => g.kind))].map(k => WORDS[k]).join(', ');
        return idle('hint', inspected, skipped, gaps, `Camera and board may differ (${plural(gaps.length)}: ${kinds})`);
      }
      return idle('idle', inspected, skipped, gaps);
    },
    /** Zones the check last confirmed (for tests and the debug overlay). */
    confirmedAt: () => new Map(confirmed),
    reset() { confirmed.clear(); seen.clear(); tried.clear(); last = -Infinity; },
  };
}
