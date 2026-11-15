import { fieldZoneLocation, type FieldTrack, type FieldZone } from '@yugidraft/vision';
import type { TwinCard } from '@yugidraft/shared/remote';

/** Owner-local hints only. Track churn cannot create another question in the same cell. */
export function createChangedZones() {
  const episodes = new Map<FieldZone, { ref: string; since: number; shown: boolean }>();
  return {
    observe(tracks: readonly FieldTrack[], twins: readonly TwinCard[], now: number,
      refOf: (id: string) => string, held: (ref: string, at: { zone: string; slot?: number }) => boolean) {
      const changes: FieldZone[] = [];
      for (const track of tracks) {
        const at = fieldZoneLocation(track.zone);
        const card = twins.find(c => c.zone === at.zone && c.slot === at.slot);
        if (!card || card.faceUp && !card.cardId && !card.passcode && !card.token || !['monster', 'spell-trap', 'field', 'pendulum', 'extra-monster'].includes(at.zone)) continue;
        if (held(card.ref, at)) { episodes.delete(track.zone); continue; }
        const here = tracks.filter(t => t.zone === track.zone && t.visible && !t.removed && t.restSince !== undefined && t.setEvidence?.decision !== 'not-a-card');
        const unresolved = here.some(t => t.under || t.state !== 'identified' || t.bestMatch || t.setEvidence?.decision === 'waiting' || refOf(t.id) !== card.ref ||
          t.faceDown === card.faceUp || !t.faceDown && t.cardId !== String(card.cardId ?? card.passcode ?? ''));
        if (!here.length) { const episode = episodes.get(track.zone); if (episode && !episode.shown) episode.since = now; continue; }
        if (!unresolved) { episodes.delete(track.zone); continue; }
        let episode = episodes.get(track.zone);
        if (!episode || episode.ref !== card.ref) { episode = { ref: card.ref, since: now, shown: false }; episodes.set(track.zone, episode); }
        if (now - episode.since >= 1200) episode.shown = true;
      }
      for (const [zone, episode] of episodes) {
        const at = fieldZoneLocation(zone);
        if (!twins.some(c => c.ref === episode.ref && c.zone === at.zone && c.slot === at.slot) || held(episode.ref, at)) episodes.delete(zone);
        else if (episode.shown) changes.push(zone);
        else if (!tracks.some(t => t.zone === zone && t.visible && !t.removed && t.restSince !== undefined)) episode.since = now;
      }
      return changes;
    },
  };
}
